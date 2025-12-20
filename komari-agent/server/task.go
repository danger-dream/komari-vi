package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"math"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/komari-monitor/komari-agent/ws"
	ping "github.com/prometheus-community/pro-bing"
)

func NewTask(task_id, command string) {
	if task_id == "" {
		return
	}
	if command == "" {
		uploadTaskResult(task_id, "No command provided", 0, time.Now())
		return
	}
	if flags.DisableWebSsh {
		uploadTaskResult(task_id, "Remote control is disabled.", -1, time.Now())
		return
	}
	log.Printf("Executing task %s with command: %s", task_id, command)
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "+command)
	} else {
		cmd = exec.Command("sh", "-c", command)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	finishedAt := time.Now()

	result := stdout.String()
	if stderr.Len() > 0 {
		result += "\n" + stderr.String()
	}
	result = strings.ReplaceAll(result, "\r\n", "\n")
	exitCode := 0
	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			exitCode = exitError.ExitCode()
		}
	}

	uploadTaskResult(task_id, result, exitCode, finishedAt)
}

func uploadTaskResult(taskID, result string, exitCode int, finishedAt time.Time) {
	payload := map[string]interface{}{
		"task_id":     taskID,
		"result":      result,
		"exit_code":   exitCode,
		"finished_at": finishedAt,
	}

	jsonData, _ := json.Marshal(payload)
	endpoint := flags.Endpoint + "/api/clients/task/result?token=" + flags.Token

	// 创建HTTP请求以支持自定义头部
	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("Failed to create task result request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	// 添加Cloudflare Access头部（如果配置了）
	if flags.CFAccessClientID != "" && flags.CFAccessClientSecret != "" {
		req.Header.Set("CF-Access-Client-Id", flags.CFAccessClientID)
		req.Header.Set("CF-Access-Client-Secret", flags.CFAccessClientSecret)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	maxRetry := flags.MaxRetries
	for i := 0; i < maxRetry && (err != nil || resp.StatusCode != http.StatusOK); i++ {
		log.Printf("Failed to upload task result, retrying %d/%d", i+1, maxRetry)
		time.Sleep(2 * time.Second) // Wait before retrying
		resp, err = client.Do(req)
	}
	if resp != nil {
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			log.Printf("Failed to upload task result: %s", resp.Status)
		}
	}
}

// resolveIP 解析域名到 IP 地址，排除 DNS 查询时间
func resolveIP(target string) (string, error) {
	// 如果已经是 IP 地址，直接返回
	if ip := net.ParseIP(target); ip != nil {
		return target, nil
	}
	// 解析域名到 IP
	addrs, err := net.LookupHost(target)
	if err != nil || len(addrs) == 0 {
		return "", errors.New("failed to resolve target")
	}
	return addrs[0], nil // 返回第一个解析的 IP
}

func icmpPing(target string, timeout time.Duration) (int64, error) {
	host, _, err := net.SplitHostPort(target)
	if err != nil {
		host = target
	}
	// For ICMP, we only need the host/IP, port is irrelevant.
	// If the host is an IPv6 literal, it might be wrapped in brackets.
	host = strings.Trim(host, "[]")

	// 先解析 IP 地址
	ip, err := resolveIP(host)
	if err != nil {
		return -1, err
	}

	pinger, err := ping.NewPinger(ip)
	if err != nil {
		return -1, err
	}
	defer pinger.Stop()
	pinger.Count = 1
	pinger.Timeout = timeout
	pinger.SetPrivileged(true)
	err = pinger.Run()
	if err != nil {
		return -1, err
	}
	stats := pinger.Statistics()
	if stats.PacketsRecv == 0 {
		return -1, errors.New("no packets received")
	}
	return stats.AvgRtt.Milliseconds(), nil
}

func tcpPing(target string, timeout time.Duration) (int64, error) {
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		// No port, assume port 80
		host = target
		port = "80"
	}

	ip, err := resolveIP(host)
	if err != nil {
		return -1, err
	}

	targetAddr := net.JoinHostPort(ip, port)
	start := time.Now()
	conn, err := net.DialTimeout("tcp", targetAddr, timeout)
	if err != nil {
		return -1, err
	}
	defer conn.Close()
	return time.Since(start).Milliseconds(), nil
}

func httpPing(target string, timeout time.Duration) (int64, error) {
	// Handle raw IPv6 address for URL
	if strings.Contains(target, ":") && !strings.Contains(target, "[") {
		// check if it's a valid IP to avoid wrapping hostnames
		if ip := net.ParseIP(target); ip != nil && ip.To4() == nil {
			target = "[" + target + "]"
		}
	}

	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		target = "http://" + target
	}

	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				// 在 Dial 之前解析 IP，排除 DNS 时间
				host, port, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, err
				}
				ip, err := resolveIP(host)
				if err != nil {
					return nil, err
				}
				return net.DialTimeout(network, net.JoinHostPort(ip, port), timeout)
			},
		},
	}
	start := time.Now()
	resp, err := client.Get(target)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return -1, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		return latency, nil
	}
	return latency, errors.New("http status not ok")
}

// SmokePing 风格：一次发送多包，返回每包 RTT（丢包 -1）
func icmpPingMulti(target string, count int, timeout time.Duration, payloadSize int) ([]float64, error) {
	host, _, err := net.SplitHostPort(target)
	if err != nil {
		host = target
	}
	host = strings.Trim(host, "[]")
	ip, err := resolveIP(host)
	if err != nil {
		return nil, err
	}

	pinger, err := ping.NewPinger(ip)
	if err != nil {
		return nil, err
	}
	defer pinger.Stop()
	pinger.Count = count
	// Timeout 在 pro-bing 中是整体超时，如果仍然使用单次 timeout，很容易在发送完第一包后就因总超时结束。
	// 这里把整体超时放大到 count 倍，并根据超时设置发送间隔，避免出现“首包成功其余全 -1”的假丢包。
	if count > 0 {
		pinger.Timeout = timeout * time.Duration(count)
		interval := timeout / time.Duration(count)
		if interval < 10*time.Millisecond {
			interval = 10 * time.Millisecond
		}
		pinger.Interval = interval
	} else {
		pinger.Timeout = timeout
	}
	pinger.SetPrivileged(true)
	if payloadSize > 0 {
		pinger.Size = payloadSize
	}

	results := make([]float64, 0, count)
	pinger.OnRecv = func(pkt *ping.Packet) {
		results = append(results, toMs(pkt.Rtt))
	}
	if err := pinger.Run(); err != nil {
		return nil, err
	}
	stats := pinger.Statistics()
	loss := stats.PacketsSent - stats.PacketsRecv
	for i := 0; i < loss; i++ {
		results = append(results, -1)
	}
	for len(results) < count {
		results = append(results, -1)
	}
	return results, nil
}

func tcpPingMulti(target string, count int, timeout time.Duration) []float64 {
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		host = target
		port = "80"
	}
	ip, err := resolveIP(host)
	if err != nil {
		vals := make([]float64, count)
		for i := range vals {
			vals[i] = -1
		}
		return vals
	}
	targetAddr := net.JoinHostPort(ip, port)
	res := make([]float64, 0, count)
	for i := 0; i < count; i++ {
		start := time.Now()
		conn, err := net.DialTimeout("tcp", targetAddr, timeout)
		if err != nil {
			res = append(res, -1)
			continue
		}
		conn.Close()
		res = append(res, toMs(time.Since(start)))
	}
	return res
}

func httpPingMulti(target string, count int, timeout time.Duration) []float64 {
	if strings.Contains(target, ":") && !strings.Contains(target, "[") {
		if ip := net.ParseIP(target); ip != nil && ip.To4() == nil {
			target = "[" + target + "]"
		}
	}
	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		target = "http://" + target
	}
	res := make([]float64, 0, count)
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				host, port, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, err
				}
				ip, err := resolveIP(host)
				if err != nil {
					return nil, err
				}
				return net.DialTimeout(network, net.JoinHostPort(ip, port), timeout)
			},
		},
	}
	for i := 0; i < count; i++ {
		start := time.Now()
		resp, err := client.Get(target)
		if err != nil {
			res = append(res, -1)
			continue
		}
		_ = resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			res = append(res, toMs(time.Since(start)))
		} else {
			res = append(res, -1)
		}
	}
	return res
}

func NewPingTask(conn *ws.SafeConn, taskID uint, pingType, pingTarget string) {
	if taskID == 0 {
		log.Printf("Invalid task ID: %d", taskID)
		return
	}
	var err error = nil
	var latency int64
	pingResult := -1
	timeout := 3 * time.Second        // 默认超时时间
	const highLatencyThreshold = 1000 // ms 阈值

	measure := func() (int64, error) {
		switch pingType {
		case "icmp":
			return icmpPing(pingTarget, timeout)
		case "tcp":
			return tcpPing(pingTarget, timeout)
		case "http":
			return httpPing(pingTarget, timeout)
		default:
			return -1, errors.New("unsupported ping type")
		}
	}
	PingHighLatencyRetries := 3
	// 首次测量
	if latency, err = measure(); err == nil {
		if latency > int64(highLatencyThreshold) && PingHighLatencyRetries > 0 {
			attempts := PingHighLatencyRetries
			for i := 0; i < attempts; i++ {
				if second, err2 := measure(); err2 == nil {
					if second <= int64(highLatencyThreshold) {
						latency = second
						break
					}
					if i == attempts-1 { // 最后一次仍高
						err = errors.New("latency remains high after retries")
					}
				} else {
					err = err2
					break
				}
			}
		}
	}

	if err != nil {
		log.Printf("Ping task %d failed: %v", taskID, err)
		pingResult = -1 // 如果有错误，设置结果为 -1
	} else {
		pingResult = int(latency)
	}
	payload := map[string]interface{}{
		"type":        "ping_result",
		"task_id":     taskID,
		"ping_type":   pingType,
		"value":       pingResult,
		"finished_at": time.Now(),
	}
	// https://github.com/komari-monitor/komari/commit/eb87a4fc330b7d1c407fa4ff70177615a4f50a1f
	// -1 代表丢包，服务端计算
	//if pingResult == -1 {
	//	return
	//}
	if err := conn.WriteJSON(payload); err != nil {
		log.Printf("Failed to write JSON to WebSocket: %v", err)
	}

}

// NewSPPingTask 发送 SmokePing 风格的延迟结果
func NewSPPingTask(conn *ws.SafeConn, taskID uint, pingType, pingTarget string, pings int, timeoutMS int, payloadSize int) {
	if taskID == 0 {
		log.Printf("Invalid SP task ID: %d", taskID)
		return
	}
	if pings <= 0 {
		pings = 20
	}
	if timeoutMS <= 0 {
		timeoutMS = 1000
	}
	if payloadSize <= 0 {
		payloadSize = 56
	}
	timeout := time.Duration(timeoutMS) * time.Millisecond
	samples := make([]float64, 0, pings)
	var err error

	switch pingType {
	case "icmp":
		samples, err = icmpPingMulti(pingTarget, pings, timeout, payloadSize)
	case "tcp":
		samples = tcpPingMulti(pingTarget, pings, timeout)
	case "http":
		samples = httpPingMulti(pingTarget, pings, timeout)
	default:
		err = errors.New("unsupported ping type")
	}

	median, minV, maxV, p10, p90, loss, total := computeSPStats(samples)
	if err != nil {
		log.Printf("SP ping task %d failed: %v", taskID, err)
	}
	payload := map[string]interface{}{
		"type":        "sp_ping_result",
		"task_id":     taskID,
		"median":      median,
		"min":         minV,
		"max":         maxV,
		"p10":         p10,
		"p90":         p90,
		"loss":        loss,
		"total":       total,
		"samples":     samples,
		"finished_at": time.Now(),
		"pings":       pings,
		"timeout_ms":  timeoutMS,
	}
	if err := conn.WriteJSON(payload); err != nil {
		log.Printf("Failed to write JSON to WebSocket: %v", err)
	}
}

func computeSPStats(samples []float64) (median, minV, maxV, p10, p90 float64, loss, total int) {
	total = len(samples)
	valid := make([]float64, 0, total)
	minV, maxV = -1, -1
	for _, v := range samples {
		if v < 0 {
			loss++
			continue
		}
		valid = append(valid, v)
		if minV < 0 || v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	if len(valid) == 0 {
		return -1, -1, -1, -1, -1, loss, total
	}
	sort.Float64s(valid)
	median = percentileFloat(valid, 0.50)
	p10 = percentileFloat(valid, 0.10)
	p90 = percentileFloat(valid, 0.90)
	return roundLatency(median), roundLatency(minV), roundLatency(maxV), roundLatency(p10), roundLatency(p90), loss, total
}

func percentileFloat(values []float64, pct float64) float64 {
	if len(values) == 0 {
		return -1
	}
	if pct <= 0 {
		return values[0]
	}
	if pct >= 1 {
		return values[len(values)-1]
	}
	pos := (float64(len(values) - 1)) * pct
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	if lo == hi {
		return values[lo]
	}
	frac := pos - float64(lo)
	v := float64(values[lo]) + (float64(values[hi])-float64(values[lo]))*frac
	return math.Round(v*1000) / 1000
}

func toMs(d time.Duration) float64 {
	if d <= 0 {
		return 0
	}
	return float64(d) / float64(time.Millisecond)
}

func roundLatency(v float64) float64 {
	return math.Round(v*1000) / 1000
}
