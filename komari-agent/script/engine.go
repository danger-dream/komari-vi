package script

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/dop251/goja"
)

type Context struct {
	ScriptID    uint
	ExecID      string
	Name        string
	TriggerKind string
	TriggerName string
	TimeoutSec  int
	Endpoint    string
	Token       string
	CFAccessID  string
	CFAccessKey string
	Params      map[string]interface{}
	DisableExec bool
}

type DependencySnippet struct {
	ID         uint
	Name       string
	FolderID   *uint
	ScriptBody string
}

type Engine struct {
	vm     *goja.Runtime
	ctx    Context
	logger func(level, msg string)
	client *http.Client
	runCtx context.Context
}

func NewEngine(ctx Context, mainScript string, deps []DependencySnippet, logger func(level, msg string)) (*Engine, error) {
	vm := goja.New()
	e := &Engine{
		vm:     vm,
		ctx:    ctx,
		logger: logger,
		client: &http.Client{Timeout: 30 * time.Second},
	}
	e.registerConsole()
	e.registerFetch()
	e.registerExec()
	e.registerStorage()
	e.registerFS()
	e.registerPath()
	e.registerOS()
	e.registerProcess()

	for _, dep := range deps {
		if _, err := vm.RunString(dep.ScriptBody); err != nil {
			return nil, fmt.Errorf("dependency %s error: %w", dep.Name, err)
		}
	}
	if _, err := vm.RunString(mainScript); err != nil {
		return nil, err
	}
	return e, nil
}

func (e *Engine) Run(ctx context.Context) (interface{}, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	e.runCtx = ctx
	runVal := e.vm.Get("run")
	runFunc, ok := goja.AssertFunction(runVal)
	if !ok {
		return nil, errors.New("run is not a function")
	}
	result, err := runFunc(goja.Undefined(), e.vm.ToValue(e.ctx))
	if err != nil {
		return nil, err
	}
	if promise, ok := result.Export().(*goja.Promise); ok {
		switch promise.State() {
		case goja.PromiseStateFulfilled:
			return promise.Result().Export(), nil
		case goja.PromiseStateRejected:
			return nil, fmt.Errorf("promise rejected: %v", promise.Result().Export())
		default:
			return nil, errors.New("run returned a pending promise; async operations are not supported")
		}
	}
	return result.Export(), nil
}

func (e *Engine) currentCtx() context.Context {
	if e.runCtx != nil {
		return e.runCtx
	}
	return context.Background()
}

func (e *Engine) registerConsole() {
	console := e.vm.NewObject()
	console.Set("log", func(call goja.FunctionCall) goja.Value {
		msg := joinArgs(call.Arguments)
		if e.logger != nil {
			e.logger("info", msg)
		}
		return goja.Undefined()
	})
	console.Set("error", func(call goja.FunctionCall) goja.Value {
		msg := joinArgs(call.Arguments)
		if e.logger != nil {
			e.logger("error", msg)
		}
		return goja.Undefined()
	})
	e.vm.Set("console", console)
}

func (e *Engine) registerFetch() {
	backend := func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			panic(e.vm.ToValue("path or url required"))
		}
		url := call.Arguments[0].String()
		if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
			url = strings.TrimSuffix(e.ctx.Endpoint, "/") + "/" + strings.TrimPrefix(url, "/")
		}
		var body io.Reader
		if len(call.Arguments) > 1 && !goja.IsNull(call.Arguments[1]) && !goja.IsUndefined(call.Arguments[1]) {
			opt := call.Arguments[1].Export()
			if m, ok := opt.(map[string]interface{}); ok {
				if b, ok := m["body"]; ok {
					body = strings.NewReader(fmt.Sprint(b))
				}
			}
		}
		req, err := http.NewRequestWithContext(e.currentCtx(), "GET", url, body)
		if err != nil {
			panic(e.vm.ToValue(err.Error()))
		}
		if len(call.Arguments) > 1 {
			if m, ok := call.Arguments[1].Export().(map[string]interface{}); ok {
				if method, ok := m["method"].(string); ok && method != "" {
					req.Method = method
				}
				if hdrs, ok := m["headers"].(map[string]interface{}); ok {
					for k, v := range hdrs {
						req.Header.Set(k, fmt.Sprint(v))
					}
				}
			}
		}
		if e.ctx.Token != "" {
			req.Header.Set("Authorization", "Bearer "+e.ctx.Token)
		}
		if e.ctx.CFAccessID != "" && e.ctx.CFAccessKey != "" {
			req.Header.Set("CF-Access-Client-Id", e.ctx.CFAccessID)
			req.Header.Set("CF-Access-Client-Secret", e.ctx.CFAccessKey)
		}
		resp, err := e.client.Do(req)
		if err != nil {
			panic(e.vm.ToValue(err.Error()))
		}
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(resp.Body)
		return e.newResponse(resp.StatusCode, respBody)
	}
	external := func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			panic(e.vm.ToValue("url required"))
		}
		url := call.Arguments[0].String()
		if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
			panic(e.vm.ToValue("invalid url"))
		}
		var body io.Reader
		if len(call.Arguments) > 1 && !goja.IsNull(call.Arguments[1]) && !goja.IsUndefined(call.Arguments[1]) {
			opt := call.Arguments[1].Export()
			if m, ok := opt.(map[string]interface{}); ok {
				if b, ok := m["body"]; ok {
					body = strings.NewReader(fmt.Sprint(b))
				}
			}
		}
		req, err := http.NewRequestWithContext(e.currentCtx(), "GET", url, body)
		if err != nil {
			panic(e.vm.ToValue(err.Error()))
		}
		if len(call.Arguments) > 1 {
			if m, ok := call.Arguments[1].Export().(map[string]interface{}); ok {
				if method, ok := m["method"].(string); ok && method != "" {
					req.Method = method
				}
				if hdrs, ok := m["headers"].(map[string]interface{}); ok {
					for k, v := range hdrs {
						req.Header.Set(k, fmt.Sprint(v))
					}
				}
			}
		}
		resp, err := e.client.Do(req)
		if err != nil {
			panic(e.vm.ToValue(err.Error()))
		}
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(resp.Body)
		return e.newResponse(resp.StatusCode, respBody)
	}
	e.vm.Set("fetchBackend", backend)
	e.vm.Set("fetchExternal", external)
}

func (e *Engine) registerExec() {
	e.vm.Set("exec", func(call goja.FunctionCall) goja.Value {
		if e.ctx.DisableExec {
			panic(e.vm.ToValue("exec disabled"))
		}
		if len(call.Arguments) == 0 {
			panic(e.vm.ToValue("command required"))
		}
		cmdStr := call.Arguments[0].String()
		parentCtx := e.currentCtx()
		ctxCmd := parentCtx
		var cancel context.CancelFunc
		if e.ctx.TimeoutSec > 0 {
			ctxCmd, cancel = context.WithTimeout(parentCtx, time.Duration(e.ctx.TimeoutSec)*time.Second)
			defer cancel()
		}
		cmd := exec.CommandContext(ctxCmd, "bash", "-c", cmdStr)
		if runtime.GOOS == "windows" {
			cmd = exec.CommandContext(ctxCmd, "cmd", "/C", cmdStr)
		}
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		err := cmd.Run()
		code := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				code = exitErr.ExitCode()
			} else {
				code = -1
			}
		}
		obj := e.vm.NewObject()
		obj.Set("stdout", stdout.String())
		obj.Set("stderr", stderr.String())
		obj.Set("code", code)
		return obj
	})
}

func (e *Engine) registerStorage() {
	storageObj := e.vm.NewObject()
	createScope := func(scope string) *goja.Object {
		obj := e.vm.NewObject()
		obj.Set("setItem", func(call goja.FunctionCall) goja.Value {
			if len(call.Arguments) < 2 {
				panic(e.vm.ToValue("key and value required"))
			}
			key := call.Arguments[0].String()
			val := call.Arguments[1].Export()
			raw, _ := json.Marshal(val)
			valueType := detectValueType(val)
			payload := map[string]interface{}{
				"scope":      scope,
				"key":        key,
				"value":      string(raw),
				"value_type": valueType,
			}
			if scope != "global" {
				payload["script_id"] = e.ctx.ScriptID
			}
			if err := e.callStorageEndpoint("/api/clients/script/storage/set", payload); err != nil {
				panic(e.vm.ToValue(err.Error()))
			}
			return goja.Undefined()
		})
		obj.Set("getItem", func(call goja.FunctionCall) goja.Value {
			if len(call.Arguments) == 0 {
				panic(e.vm.ToValue("key required"))
			}
			key := call.Arguments[0].String()
			var defaultVal goja.Value
			if len(call.Arguments) > 1 {
				defaultVal = call.Arguments[1]
			}
			payload := map[string]interface{}{
				"scope": scope,
				"key":   key,
			}
			if scope != "global" {
				payload["script_id"] = e.ctx.ScriptID
			}
			respBody, err := e.callStorageGet("/api/clients/script/storage/get", payload)
			if err != nil {
				panic(e.vm.ToValue(err.Error()))
			}
			var result struct {
				Status string `json:"status"`
				Data   struct {
					Found     bool   `json:"found"`
					Value     string `json:"value"`
					ValueType string `json:"value_type"`
				} `json:"data"`
			}
			_ = json.Unmarshal(respBody, &result)
			if !result.Data.Found {
				if defaultVal != nil {
					return defaultVal
				}
				return goja.Null()
			}
			var parsed interface{}
			if err := json.Unmarshal([]byte(result.Data.Value), &parsed); err != nil {
				return e.vm.ToValue(result.Data.Value)
			}
			return e.vm.ToValue(parsed)
		})
		return obj
	}
	storageObj.Set("script", createScope("script"))
	storageObj.Set("node", createScope("node"))
	storageObj.Set("global", createScope("global"))
	e.vm.Set("storage", storageObj)
}

func (e *Engine) callStorageEndpoint(path string, payload map[string]interface{}) error {
	buf, _ := json.Marshal(payload)
	url := strings.TrimSuffix(e.ctx.Endpoint, "/") + path + "?token=" + e.ctx.Token
	req, err := http.NewRequestWithContext(e.currentCtx(), "POST", url, bytes.NewBuffer(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if e.ctx.CFAccessID != "" && e.ctx.CFAccessKey != "" {
		req.Header.Set("CF-Access-Client-Id", e.ctx.CFAccessID)
		req.Header.Set("CF-Access-Client-Secret", e.ctx.CFAccessKey)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("storage set failed: %s", string(body))
	}
	return nil
}

func (e *Engine) callStorageGet(path string, payload map[string]interface{}) ([]byte, error) {
	buf, _ := json.Marshal(payload)
	url := strings.TrimSuffix(e.ctx.Endpoint, "/") + path + "?token=" + e.ctx.Token
	req, err := http.NewRequestWithContext(e.currentCtx(), "POST", url, bytes.NewBuffer(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if e.ctx.CFAccessID != "" && e.ctx.CFAccessKey != "" {
		req.Header.Set("CF-Access-Client-Id", e.ctx.CFAccessID)
		req.Header.Set("CF-Access-Client-Secret", e.ctx.CFAccessKey)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func (e *Engine) registerFS() {
	fsObj := e.vm.NewObject()
	fsObj.Set("readFile", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			panic(e.vm.ToValue("path required"))
		}
		path := call.Arguments[0].String()
		data, err := os.ReadFile(path)
		if err != nil {
			panic(e.vm.ToValue(err.Error()))
		}
		return e.vm.ToValue(string(data))
	})
	fsObj.Set("writeFile", func(call goja.FunctionCall) goja.Value {
		if e.ctx.DisableExec {
			panic(e.vm.ToValue("write disabled"))
		}
		if len(call.Arguments) < 2 {
			panic(e.vm.ToValue("path and data required"))
		}
		path := call.Arguments[0].String()
		data := call.Arguments[1].String()
		if err := os.WriteFile(path, []byte(data), 0644); err != nil {
			panic(e.vm.ToValue(err.Error()))
		}
		return goja.Undefined()
	})
	fsObj.Set("exists", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return e.vm.ToValue(false)
		}
		path := call.Arguments[0].String()
		_, err := os.Stat(path)
		return e.vm.ToValue(err == nil)
	})
	e.vm.Set("fs", fsObj)
}

func (e *Engine) registerPath() {
	pathObj := e.vm.NewObject()
	pathObj.Set("join", func(call goja.FunctionCall) goja.Value {
		parts := make([]string, 0, len(call.Arguments))
		for _, a := range call.Arguments {
			parts = append(parts, a.String())
		}
		return e.vm.ToValue(filepath.Join(parts...))
	})
	pathObj.Set("basename", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return e.vm.ToValue("")
		}
		return e.vm.ToValue(filepath.Base(call.Arguments[0].String()))
	})
	pathObj.Set("dirname", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return e.vm.ToValue("")
		}
		return e.vm.ToValue(filepath.Dir(call.Arguments[0].String()))
	})
	e.vm.Set("path", pathObj)
}

func (e *Engine) registerOS() {
	osObj := e.vm.NewObject()
	osObj.Set("platform", func(goja.FunctionCall) goja.Value {
		return e.vm.ToValue(runtime.GOOS)
	})
	osObj.Set("arch", func(goja.FunctionCall) goja.Value {
		return e.vm.ToValue(runtime.GOARCH)
	})
	e.vm.Set("os", osObj)
}

func (e *Engine) registerProcess() {
	env := make(map[string]string)
	for _, kv := range os.Environ() {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) == 2 {
			env[parts[0]] = parts[1]
		}
	}
	proc := e.vm.NewObject()
	proc.Set("env", env)
	proc.Set("cwd", func(goja.FunctionCall) goja.Value {
		dir, _ := os.Getwd()
		return e.vm.ToValue(dir)
	})
	e.vm.Set("process", proc)
}

func (e *Engine) newResponse(status int, body []byte) goja.Value {
	obj := e.vm.NewObject()
	obj.Set("status", status)
	obj.Set("ok", status >= 200 && status < 300)
	obj.Set("text", func(goja.FunctionCall) goja.Value {
		return e.vm.ToValue(string(body))
	})
	obj.Set("json", func(goja.FunctionCall) goja.Value {
		var v interface{}
		if err := json.Unmarshal(body, &v); err != nil {
			return e.vm.ToValue(nil)
		}
		return e.vm.ToValue(v)
	})
	return obj
}

func detectValueType(val interface{}) string {
	switch val.(type) {
	case string:
		return "string"
	case bool:
		return "boolean"
	case int, int64, float64, float32:
		return "number"
	case []interface{}:
		return "array"
	case map[string]interface{}:
		return "object"
	case nil:
		return "null"
	default:
		return "unknown"
	}
}

func joinArgs(args []goja.Value) string {
	parts := make([]string, 0, len(args))
	for _, a := range args {
		parts = append(parts, a.String())
	}
	return strings.Join(parts, " ")
}
