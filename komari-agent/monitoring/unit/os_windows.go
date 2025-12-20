//go:build windows
// +build windows

package monitoring

import (
	"strconv"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func OSName() string {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err != nil {
		return "Microsoft Windows"
	}
	defer key.Close()

	productName, _, err := key.GetStringValue("ProductName")
	if err != nil {
		return "Microsoft Windows"
	}

	// Server 版本保持原样
	if strings.Contains(productName, "Server") {
		return productName
	}

	// 如果注册表已经直接提供 Windows 11 名称，直接返回
	if strings.Contains(productName, "Windows 11") {
		return productName
	}

	// Windows 11 从 build 22000 起。DisplayVersion 在 Win10 21H2 也会是 21H2，不能作为判断依据。
	buildNumberStr, _, err := key.GetStringValue("CurrentBuild")
	if err == nil {
		if buildNumber, err2 := strconv.Atoi(buildNumberStr); err2 == nil && buildNumber >= 22000 {
			// 旧字段可能仍然写着 Windows 10，把前缀替换为 Windows 11
			if strings.HasPrefix(productName, "Windows 10 ") {
				edition := strings.TrimPrefix(productName, "Windows 10 ")
				return "Windows 11 " + edition
			}
			if productName == "Windows 10" { // 极端精简情况
				return "Windows 11"
			}
			// 如果不是以 Windows 10 开头，但 build 已经 >= 22000，直接补成 Windows 11 + 原名称尾部
			if !strings.Contains(productName, "Windows 11") {
				return strings.Replace(productName, "Windows 10", "Windows 11", 1)
			}
		}
	}

	return productName
}

// KernelVersion returns the kernel version on Windows systems (build number)
func KernelVersion() string {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err != nil {
		return "Unknown"
	}
	defer key.Close()

	// Get current build number
	buildNumber, _, err := key.GetStringValue("CurrentBuild")
	if err != nil {
		return "Unknown"
	}

	// Get UBR (Update Build Revision) if available
	ubr, _, err := key.GetIntegerValue("UBR")
	if err != nil {
		// UBR not available, just return build number
		return buildNumber
	}

	return buildNumber + "." + strconv.FormatUint(ubr, 10)
}
