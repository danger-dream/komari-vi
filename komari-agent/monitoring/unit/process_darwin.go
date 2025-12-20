//go:build darwin
// +build darwin

package monitoring

import (
	"os/exec"
	"strings"
)

// ProcessCount returns the number of running processes on Darwin (macOS)
func ProcessCount() (count int) {
	return processCountDarwin()
}

// processCountDarwin counts processes using the `ps` command
func processCountDarwin() (count int) {
	cmd := exec.Command("ps", "-A")
	output, err := cmd.Output()
	if err != nil {
		return 0
	}

	// Count the number of lines in the output, excluding the header line
	lines := strings.Split(string(output), "\n")
	return len(lines) - 1
}
