//go:build windows
// +build windows

package monitoring

import (
	"syscall"
	"unsafe"
)

// ProcessCount returns the number of running processes
func ProcessCount() (count int) {
	return processCountWindows()

}

// processCountWindows counts processes using Windows API
func processCountWindows() (count int) {
	// Load kernel32.dll
	kernel32, err := syscall.LoadLibrary("kernel32.dll")
	if err != nil {
		return 0
	}
	defer syscall.FreeLibrary(kernel32)

	// Get EnumProcesses function
	enumProcesses, err := syscall.GetProcAddress(kernel32, "K32EnumProcesses")
	if err != nil {
		return 0
	}

	// Prepare buffer for process IDs
	const maxProcesses = 1024
	pids := make([]uint32, maxProcesses)
	var bytesReturned uint32

	// Call EnumProcesses
	ret, _, _ := syscall.SyscallN(
		uintptr(enumProcesses),
		uintptr(unsafe.Pointer(&pids[0])),
		uintptr(len(pids)*4),
		uintptr(unsafe.Pointer(&bytesReturned)),
	)

	if ret == 0 {
		return 0
	}

	// Count valid PIDs
	count = int(bytesReturned) / 4 // bytesReturned is size in bytes, divide by 4 for uint32 count
	if count > maxProcesses {
		count = maxProcesses
	}

	return count
}
