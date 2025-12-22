package forward

import (
	"log"
	"os/exec"
	"strconv"
	"strings"
)

type FirewallTool string

const (
	FirewallUnknown  FirewallTool = "unknown"
	FirewallUFW      FirewallTool = "ufw"
	FirewallIptables FirewallTool = "iptables"
	FirewallNFT      FirewallTool = "nftables"
)

type FirewallManager struct {
	Tool FirewallTool
}

func NewFirewallManager() *FirewallManager {
	return &FirewallManager{
		Tool: detectFirewallTool(),
	}
}

func detectFirewallTool() FirewallTool {
	if _, err := exec.LookPath("ufw"); err == nil {
		return FirewallUFW
	}
	if _, err := exec.LookPath("nft"); err == nil {
		return FirewallNFT
	}
	if _, err := exec.LookPath("iptables"); err == nil {
		return FirewallIptables
	}
	return FirewallUnknown
}

func (f *FirewallManager) Detect() FirewallTool {
	if f.Tool == "" || f.Tool == FirewallUnknown {
		f.Tool = detectFirewallTool()
	}
	return f.Tool
}

func (f *FirewallManager) OpenPort(port int, protocol string) error {
	switch f.Detect() {
	case FirewallUFW:
		return runCmd("ufw", "allow", protoPort(protocol, port))
	case FirewallNFT:
		// 添加简单的接受规则，默认表/链
		return runCmd("nft", "add", "rule", "inet", "filter", "input", strings.ToLower(protocol), "dport", strconv.Itoa(port), "accept")
	case FirewallIptables:
		// 先检查是否已存在，避免重复
		checkErr := exec.Command("iptables", "-C", "INPUT", "-p", strings.ToLower(protocol), "--dport", strconv.Itoa(port), "-j", "ACCEPT").Run()
		if checkErr == nil {
			return nil
		}
		return runCmd("iptables", "-I", "INPUT", "-p", strings.ToLower(protocol), "--dport", strconv.Itoa(port), "-j", "ACCEPT")
	default:
		log.Printf("firewall tool unknown, skip open port %d/%s", port, protocol)
		return nil
	}
}

func (f *FirewallManager) ClosePort(port int, protocol string) error {
	switch f.Detect() {
	case FirewallUFW:
		return runCmd("ufw", "delete", "allow", protoPort(protocol, port))
	case FirewallNFT:
		// 尝试删除规则，忽略失败
		_ = runCmd("nft", "delete", "rule", "inet", "filter", "input", strings.ToLower(protocol), "dport", strconv.Itoa(port), "accept")
		return nil
	case FirewallIptables:
		_ = runCmd("iptables", "-D", "INPUT", "-p", strings.ToLower(protocol), "--dport", strconv.Itoa(port), "-j", "ACCEPT")
		return nil
	default:
		log.Printf("firewall tool unknown, skip close port %d/%s", port, protocol)
		return nil
	}
}

func protoPort(protocol string, port int) string {
	proto := strings.ToLower(protocol)
	if proto == "udp" {
		return strconv.Itoa(port) + "/udp"
	}
	// default tcp
	return strconv.Itoa(port) + "/tcp"
}

func runCmd(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("firewall command failed: %s %v -> %v, output: %s", name, args, err, string(out))
		return err
	}
	return nil
}
