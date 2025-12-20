//go:build windows

package terminal

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/UserExistsError/conpty"
)

func newTerminalImpl() (*terminalImpl, error) {
	// 查找 shell
	shell, err := exec.LookPath("powershell.exe")
	if err != nil || shell == "" {
		shell = "cmd.exe"
	}
	if shell == "" {
		return nil, fmt.Errorf("no supported shell found")
	}

	// 获取工作目录
	workingDir := "."
	if executable, err := os.Executable(); err == nil {
		workingDir = filepath.Dir(executable)
	}

	// 启动 ConPTY
	tty, err := conpty.Start(shell, conpty.ConPtyWorkDir(workingDir))
	if err != nil {
		return nil, fmt.Errorf("failed to start conpty: %v", err)
	}

	// 设置初始终端大小
	tty.Resize(80, 24)

	return &terminalImpl{
		shell:      shell,
		workingDir: workingDir,
		term: &windowsTerminal{
			tty: tty,
		},
	}, nil
}

type windowsTerminal struct {
	tty    *conpty.ConPty
	closed bool
}

func (t *windowsTerminal) Close() error {
	if t.closed {
		return nil
	}
	if err := t.tty.Close(); err != nil {
		return err
	}
	t.closed = true
	return nil
}

func (t *windowsTerminal) Read(p []byte) (int, error) {
	return t.tty.Read(p)
}

func (t *windowsTerminal) Write(p []byte) (int, error) {
	return t.tty.Write(p)
}

func (t *windowsTerminal) Resize(cols, rows int) error {
	return t.tty.Resize(cols, rows)
}

func (t *windowsTerminal) Wait() error {
	_, err := t.tty.Wait(context.Background())
	return err
}
