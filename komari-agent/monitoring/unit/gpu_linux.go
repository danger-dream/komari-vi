//go:build linux
// +build linux

package monitoring

import (
	"os/exec"
	"strings"
)

func GpuName() string {
	// 调整优先级：专用显卡厂商优先，避免只识别集成显卡
	accept := []string{"nvidia", "amd", "radeon", "vga", "3d"}
	out, err := exec.Command("lspci").Output()
	if err == nil {
		lines := strings.Split(string(out), "\n")
		
		// 首先尝试找专用显卡
		for _, line := range lines {
			lower := strings.ToLower(line)
			
			// 跳过集成显卡和管理控制器
			if strings.Contains(lower, "aspeed") || 
			   strings.Contains(lower, "matrox") ||
			   strings.Contains(lower, "management") {
				continue
			}
			
			// 优先匹配专用显卡厂商
			for _, a := range accept {
				if strings.Contains(lower, a) {
					parts := strings.SplitN(line, ":", 4)
					if len(parts) >= 4 {
						return strings.TrimSpace(parts[3])
					} else if len(parts) == 3 {
						return strings.TrimSpace(parts[2])
					} else if len(parts) == 2 {
						return strings.TrimSpace(parts[1])
					}
				}
			}
		}
		
		// 如果没有找到专用显卡，返回第一个VGA设备作为兜底
		for _, line := range lines {
			if strings.Contains(strings.ToLower(line), "vga") {
				parts := strings.SplitN(line, ":", 4)
				if len(parts) >= 3 {
					return strings.TrimSpace(parts[2])
				}
			}
		}
	}
	return "None"
}
