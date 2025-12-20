//go:build windows
// +build windows

package monitoring

import (
	"strings"

	"golang.org/x/sys/windows/registry"
)

func GpuName() string {
	displayPath := `SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}`
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, displayPath, registry.READ)
	if err != nil {
		return "Unknown"
	}
	defer k.Close()

	subKeys, err := k.ReadSubKeyNames(-1)
	if err != nil {
		return "Unknown"
	}
	gpuName := ""
	for _, subKey := range subKeys {
		if !strings.HasPrefix(subKey, "0") {
			continue
		}

		fullPath := displayPath + "\\" + subKey
		sk, err := registry.OpenKey(registry.LOCAL_MACHINE, fullPath, registry.READ)
		if err != nil {
			continue
		}
		defer sk.Close()

		deviceDesc, _, err := sk.GetStringValue("DriverDesc")
		if err != nil || deviceDesc == "" {
			continue
		}
		deviceDesc = strings.TrimSpace(deviceDesc)
		// 只接受支持 OpenGL 的 GPU
		openGLVersion, _, err := sk.GetIntegerValue("OpenGLVersion")
		if err != nil || openGLVersion == 0 {
			continue
		}
		gpuName += deviceDesc + ", "
	}

	if gpuName != "" {
		return strings.TrimSuffix(gpuName, ", ")
	}
	return "None"
}
