//go:build freebsd
// +build freebsd

package monitoring

import (
	"os/exec"
	"strings"
)

// ProcessCount returns the number of running processes on FreeBSD
func ProcessCount() (count int) {
	return processCountFreeBSD()
}

// processCountFreeBSD counts processes using the `ps` command
func processCountFreeBSD() (count int) {
	cmd := exec.Command("ps", "-ax")
	output, err := cmd.Output()
	if err != nil {
		return 0
	}

	// Count the number of lines in the output, excluding the header line
	lines := strings.Split(string(output), "\n")
	return len(lines) - 1
}
