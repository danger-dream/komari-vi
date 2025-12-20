//go:build freebsd
// +build freebsd

package monitoring

import (
	"os/exec"
	"strings"
)

// OSName returns the name of the operating system on FreeBSD
func OSName() string {
	cmd := exec.Command("uname", "-sr")
	output, err := cmd.Output()
	if err != nil {
		return "FreeBSD"
	}

	name := strings.TrimSpace(string(output))
	return name
}

// KernelVersion returns the kernel version on FreeBSD
func KernelVersion() string {
	cmd := exec.Command("uname", "-r")
	output, err := cmd.Output()
	if err != nil {
		return "Unknown"
	}

	return strings.TrimSpace(string(output))
}
