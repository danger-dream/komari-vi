//go:build darwin
// +build darwin

package monitoring

import (
	"os/exec"
	"strings"
)

// GpuName returns the name of the GPU on Darwin (macOS)
func GpuName() string {
	cmd := exec.Command("system_profiler", "SPDisplaysDataType")
	output, err := cmd.Output()
	if err != nil {
		return "Unknown"
	}

	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Chipset Model:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "Chipset Model:"))
		}
	}

	return "Unknown"
}
