//go:build !windows

package cmd

func WarnKomariRunning() {
	// No-op on non-Windows platforms
	return
}

func ShowToast() {
	// No-op on non-Windows platforms
	return
}
