package forward

import (
	"bufio"
	"bytes"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// 链命名：KOMARI_FWD_{ruleID}_{port}_IN / OUT，确保长度可控
func chainNames(ruleID uint, port int) (string, string) {
	return fmt.Sprintf("KOMARI_FWD_%d_%d_IN", ruleID, port), fmt.Sprintf("KOMARI_FWD_%d_%d_OUT", ruleID, port)
}

func setupIptablesRules(ruleID uint, port int, protocol string) error {
	inChain, outChain := chainNames(ruleID, port)

	// 创建链（若已存在忽略）
	_ = exec.Command("iptables", "-N", inChain).Run()
	_ = exec.Command("iptables", "-N", outChain).Run()
	// 确保链内 ACCEPT 规则存在
	_ = exec.Command("iptables", "-F", inChain).Run()
	_ = exec.Command("iptables", "-F", outChain).Run()
	_ = exec.Command("iptables", "-A", inChain, "-j", "ACCEPT").Run()
	_ = exec.Command("iptables", "-A", outChain, "-j", "ACCEPT").Run()

	// 在 INPUT/OUTPUT 插入跳转规则（若不存在）
	for _, proto := range normalizeProtocols(protocol) {
		addJumpIfMissing([]string{"INPUT", "-p", proto, "--dport", strconv.Itoa(port), "-j", inChain})
		addJumpIfMissing([]string{"OUTPUT", "-p", proto, "--sport", strconv.Itoa(port), "-j", outChain})
	}
	return nil
}

func cleanupIptablesRules(ruleID uint, port int, protocol string) {
	inChain, outChain := chainNames(ruleID, port)
	// 删除跳转规则
	for _, proto := range normalizeProtocols(protocol) {
		_ = exec.Command("iptables", "-D", "INPUT", "-p", proto, "--dport", strconv.Itoa(port), "-j", inChain).Run()
		_ = exec.Command("iptables", "-D", "OUTPUT", "-p", proto, "--sport", strconv.Itoa(port), "-j", outChain).Run()
	}
	// 清空并删除链
	_ = exec.Command("iptables", "-F", inChain).Run()
	_ = exec.Command("iptables", "-X", inChain).Run()
	_ = exec.Command("iptables", "-F", outChain).Run()
	_ = exec.Command("iptables", "-X", outChain).Run()
}

func addJumpIfMissing(args []string) {
	// 检查是否存在
	check := append([]string{"-C"}, args...)
	if err := exec.Command("iptables", check...).Run(); err == nil {
		return
	}
	_ = exec.Command("iptables", append([]string{"-I"}, args...)...).Run()
}

type iptCounters struct {
	Pkts  int64
	Bytes int64
}

func readChainCounters(chain string) (iptCounters, error) {
	cmd := exec.Command("iptables", "-nvxL", chain)
	out, err := cmd.Output()
	if err != nil {
		return iptCounters{}, err
	}
	var pkts, totalBytes int64
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "Chain") || strings.HasPrefix(line, "pkts") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		p, _ := strconv.ParseInt(fields[0], 10, 64)
		b, _ := strconv.ParseInt(fields[1], 10, 64)
		pkts += p
		totalBytes += b
	}
	if err := scanner.Err(); err != nil {
		return iptCounters{}, err
	}
	return iptCounters{Pkts: pkts, Bytes: totalBytes}, nil
}

// ReadPortCounters 返回入口/出口字节数
func ReadPortCounters(ruleID uint, port int, protocol string) (in iptCounters, out iptCounters, err error) {
	inChain, outChain := chainNames(ruleID, port)
	in, err = readChainCounters(inChain)
	if err != nil {
		return
	}
	out, err = readChainCounters(outChain)
	return
}
