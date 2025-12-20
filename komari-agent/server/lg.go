package server

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

type lgStartPayload struct {
	Type    string `json:"type"`
	Tool    string `json:"tool"`
	Input   string `json:"input"`
	Timeout int    `json:"timeout"`
	Command string `json:"command"`
	IP      string `json:"ip"`
	Port    int    `json:"port"`
}

// pickShell 尽量与终端模式一致地选择交互 shell
func pickShell() (string, error) {
	userHomeDir, err := os.UserHomeDir()
	if err == nil {
		if passwdContent, err := os.ReadFile("/etc/passwd"); err == nil {
			for _, line := range strings.Split(string(passwdContent), "\n") {
				if strings.Contains(line, userHomeDir) {
					parts := strings.Split(line, ":")
					if len(parts) >= 7 && parts[6] != "" {
						if _, err := exec.LookPath(parts[6]); err == nil {
							return parts[6], nil
						}
					}
				}
			}
		}
	}
	for _, s := range []string{"zsh", "bash", "sh"} {
		if _, err := exec.LookPath(s); err == nil {
			return s, nil
		}
	}
	return "", fmt.Errorf("no available shell found")
}

func startLg(conn *websocket.Conn) {
	defer conn.Close()
	var payload lgStartPayload
	if err := conn.ReadJSON(&payload); err != nil {
		log.Println("LG read start payload error:", err)
		return
	}
	if payload.Timeout <= 0 {
		payload.Timeout = 30
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(payload.Timeout)*time.Second)
	defer cancel()

	writeMu := &sync.Mutex{}
	writeText := func(data string) {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.WriteMessage(websocket.TextMessage, []byte(data))
	}

	rawInput := payload.Input
	validatedInput, err := validateLgInput(payload.Tool, payload.Input)
	if err != nil {
		writeText("[lg] 参数无效: " + err.Error() + "\n")
		return
	}
	payload.Input = validatedInput

	shell, err := pickShell()
	if err != nil {
		writeText("未找到可用 shell: " + err.Error())
		return
	}

	commandStr := payload.Command
	if rawInput != payload.Input && rawInput != "" {
		commandStr = strings.ReplaceAll(commandStr, rawInput, payload.Input)
	}
	// iperf3: 在 Agent 侧重新选择可用端口并回显给前端
	var fwCleanup func()
	if strings.ToLower(payload.Tool) == "iperf3" {
		port, perr := pickFreePort()
		if perr != nil && payload.Port > 0 {
			port = payload.Port
		} else if perr != nil {
			writeText("[iperf3] 端口选择失败，使用默认 5201\n")
			port = 5201
		}
		commandStr = "iperf3 -s -p " + strconv.Itoa(port)
		host := payload.IP
		if host == "" {
			host = "127.0.0.1"
		}
		writeText(fmt.Sprintf("[iperf3] 已选择端口 %d，请在测试端执行: iperf3 -Rc %s -p %d\n", port, host, port))

		// 尝试临时开放防火墙端口
		if c := openFirewallPort(port, writeText); c != nil {
			fwCleanup = c
		}
	}

	if strings.ToLower(payload.Tool) == "mtr" {
		// 强制文本模式 + 禁用 DNS，保持流式输出
		params := strings.TrimSpace(commandStr)
		lower := strings.ToLower(params)
		if strings.HasPrefix(lower, "mtr") {
			params = strings.TrimSpace(params[3:])
		}
		needText := !strings.Contains(lower, "-t") && !strings.Contains(lower, "--displaymode")
		needNoDNS := !strings.Contains(lower, "-n") && !strings.Contains(lower, "--no-dns")
		flags := []string{}
		if needText {
			flags = append(flags, "-t")
		}
		if needNoDNS {
			flags = append(flags, "-n")
		}
		if params != "" {
			commandStr = "mtr " + strings.Join(flags, " ") + " " + params
		} else {
			commandStr = "mtr " + strings.Join(flags, " ")
		}
	}

	cmd := exec.CommandContext(ctx, shell, "-c", commandStr)
	env := append(os.Environ(),
		"TERM=xterm-256color",
		"LANG=C.UTF-8",
		"LC_ALL=C.UTF-8",
		"PS1=",
		"DISPLAY=",
	)
	cmd.Env = env

	tty, err := pty.Start(cmd)
	if err != nil {
		writeText("启动失败: " + err.Error())
		if fwCleanup != nil {
			fwCleanup()
		}
		return
	}
	defer func() {
		if fwCleanup != nil {
			fwCleanup()
		}
	}()

	stopChan := make(chan struct{}, 1)
	waitDone := make(chan error, 1)
	outputDone := make(chan struct{}, 1)

	// 读取浏览器指令（stop 或交互输入）
	go func() {
		for {
			msgType, data, err := conn.ReadMessage()
			if err != nil {
				stopChan <- struct{}{}
				return
			}
			lower := strings.ToLower(string(data))
			if strings.Contains(lower, "stop") {
				stopChan <- struct{}{}
				return
			}
			if msgType == websocket.TextMessage || msgType == websocket.BinaryMessage {
				_, _ = tty.Write(data)
			}
		}
	}()

	// mtr curses 会刷屏，过滤特定清屏控制序列，保留其他 ANSI
	if strings.ToLower(payload.Tool) == "mtr" {
		go forwardPlainOutput(tty, func(s string) {
			cleaned := removeClearSequences(s)
			if strings.TrimSpace(cleaned) == "" {
				return
			}
			writeText(cleaned)
		}, outputDone)
	} else {
		go forwardPlainOutput(tty, writeText, outputDone)
	}

	go func() {
		waitDone <- cmd.Wait()
	}()

	var exitMsg string
	var finished bool
	select {
	case <-stopChan:
		exitMsg = "[lg] 已请求停止\n"
		cancel()
	case err := <-waitDone:
		finished = true
		if err != nil {
			exitMsg = fmt.Sprintf("[lg] 结束，错误: %v\n", err)
		} else {
			exitMsg = "[lg] 完成\n"
		}
	case <-ctx.Done():
		exitMsg = "[lg] 已超时自动结束\n"
	}

	if exitMsg == "" {
		exitMsg = "[lg] 已结束\n"
	}

	// 确保进程退出
	if !finished {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-waitDone
	}
	cancel()
	tty.Close()
	<-outputDone

	if exitMsg != "" {
		writeText(exitMsg)
	}
}

// forwardPlainOutput 将 PTY 输出直接转发
func forwardPlainOutput(r io.Reader, writeText func(string), done chan<- struct{}) {
	defer func() { done <- struct{}{} }()
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			writeText(string(buf[:n]))
		}
		if err != nil {
			return
		}
	}
}

// pickFreePort 选取一个当前可用的 TCP 端口
func pickFreePort() (int, error) {
	l, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	addr, ok := l.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("unexpected addr type")
	}
	return addr.Port, nil
}

// openFirewallPort 尝试临时开放端口，返回清理函数（若无需清理则为 nil）
func openFirewallPort(port int, writeText func(string)) func() {
	// 优先 firewalld
	if _, err := exec.LookPath("firewall-cmd"); err == nil {
		if err := exec.Command("firewall-cmd", "--state").Run(); err == nil {
			query := exec.Command("firewall-cmd", "--query-port", fmt.Sprintf("%d/tcp", port))
			if err := query.Run(); err != nil {
				if err := exec.Command("firewall-cmd", "--add-port", fmt.Sprintf("%d/tcp", port)).Run(); err == nil {
					writeText(fmt.Sprintf("[firewall] firewalld 已临时开放 %d/tcp\n", port))
					return func() {
						_ = exec.Command("firewall-cmd", "--remove-port", fmt.Sprintf("%d/tcp", port)).Run()
					}
				}
			}
		}
	}

	// 其次 ufw
	if _, err := exec.LookPath("ufw"); err == nil {
		// 判断是否已存在规则
		check := exec.Command("sh", "-c", fmt.Sprintf("ufw status | grep -E '^%d/tcp'", port))
		if err := check.Run(); err != nil {
			if err := exec.Command("ufw", "allow", fmt.Sprintf("%d/tcp", port)).Run(); err == nil {
				writeText(fmt.Sprintf("[firewall] ufw 已临时开放 %d/tcp\n", port))
				return func() {
					_ = exec.Command("ufw", "delete", "allow", fmt.Sprintf("%d/tcp", port)).Run()
				}
			}
		}
	}

	// 最后尝试 iptables
	if _, err := exec.LookPath("iptables"); err == nil {
		check := exec.Command("iptables", "-C", "INPUT", "-p", "tcp", "--dport", fmt.Sprintf("%d", port), "-j", "ACCEPT")
		if err := check.Run(); err != nil {
			if err := exec.Command("iptables", "-I", "INPUT", "-p", "tcp", "--dport", fmt.Sprintf("%d", port), "-j", "ACCEPT").Run(); err == nil {
				writeText(fmt.Sprintf("[firewall] iptables 已临时开放 %d/tcp\n", port))
				return func() {
					_ = exec.Command("iptables", "-D", "INPUT", "-p", "tcp", "--dport", fmt.Sprintf("%d", port), "-j", "ACCEPT").Run()
				}
			}
		}
	}

	return nil
}

// removeClearSequences 专门去除已知的清屏/切换屏幕控制序列，尽量不影响其他 ANSI 输出
// 目标：\x1b[24;1H、\x1b[?1049l/\x1b[?1049h、\x1b[23;0;0t，以及缺少 ESC 前缀的残留
func removeClearSequences(s string) string {
	patterns := []string{
		`\x1b\[24;1H`,
		`\x1b\[\?1049[hl]`,
		`\x1b\[23;0;0t`,
		`\[24;1H`,      // 无 ESC 残留
		`\[\?1049[hl]`, // 无 ESC 残留
		`\[23;0;0t`,    // 无 ESC 残留
	}
	cleaned := s
	for _, pat := range patterns {
		cleaned = regexp.MustCompile(pat).ReplaceAllString(cleaned, "")
	}
	return cleaned
}
