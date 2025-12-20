package main

import (
	"os"

	"github.com/komari-monitor/komari-agent/cmd"
)

func main() {
	cmd.Execute()
	os.Exit(0)
}
