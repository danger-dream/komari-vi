package lg

import (
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/idna"
)

var (
	labelPattern  = regexp.MustCompile(`^[a-z0-9-]+$`)
	digitsPattern = regexp.MustCompile(`^[0-9]+$`)
)

func isValidIP(value string) bool {
	trimmed := strings.TrimSpace(value)
	if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
		trimmed = strings.TrimPrefix(strings.TrimSuffix(trimmed, "]"), "[")
	}
	ip := net.ParseIP(trimmed)
	return ip != nil
}

func isValidDomain(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	ascii, err := idna.Lookup.ToASCII(trimmed)
	if err != nil {
		return false
	}
	if len(ascii) == 0 || len(ascii) > 253 {
		return false
	}
	labels := strings.Split(ascii, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 {
			return false
		}
		if strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		if !labelPattern.MatchString(label) {
			return false
		}
	}
	return true
}

func isValidHost(value string) bool {
	return isValidIP(value) || isValidDomain(value)
}

// ValidateToolInput 按工具类型校验并归一化输入
func ValidateToolInput(tool, input string) (string, error) {
	tool = strings.ToLower(strings.TrimSpace(tool))
	normalized := strings.Join(strings.Fields(input), " ")
	trimmed := strings.TrimSpace(normalized)

	switch tool {
	case "iperf3":
		return "", nil
	case "speedtest":
		if trimmed == "" {
			return "", fmt.Errorf("speedtest 需要提供服务器编号")
		}
		if !digitsPattern.MatchString(trimmed) {
			return "", fmt.Errorf("speedtest 仅允许输入纯数字的服务器编号")
		}
		return trimmed, nil
	case "tcping":
		if trimmed == "" {
			return "", fmt.Errorf("tcping 需要提供目标地址")
		}
		parts := strings.Fields(trimmed)
		if len(parts) > 2 {
			return "", fmt.Errorf("tcping 仅支持“目标 [端口]”格式")
		}
		host := parts[0]
		if !isValidHost(host) {
			return "", fmt.Errorf("请输入有效的 IP 或域名")
		}
		if len(parts) == 1 {
			return host, nil
		}
		portStr := parts[1]
		if !digitsPattern.MatchString(portStr) {
			return "", fmt.Errorf("端口必须为数字")
		}
		port, _ := strconv.Atoi(portStr)
		if port < 1 || port > 65535 {
			return "", fmt.Errorf("端口需在 1-65535 之间")
		}
		return host + " " + portStr, nil
	case "ping", "mtr", "nexttrace":
		if trimmed == "" {
			return "", fmt.Errorf("%s 需要提供 IP 或域名", tool)
		}
		if len(strings.Fields(trimmed)) != 1 {
			return "", fmt.Errorf("%s 仅支持单个 IP 或域名", tool)
		}
		if !isValidHost(trimmed) {
			return "", fmt.Errorf("%s 仅允许输入 IP（IPv4/IPv6）或域名", tool)
		}
		return trimmed, nil
	default:
		return trimmed, nil
	}
}
