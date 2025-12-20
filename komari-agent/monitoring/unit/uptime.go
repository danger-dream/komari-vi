package monitoring

import (
	"github.com/shirou/gopsutil/v4/host"
)

func Uptime() (uint64, error) {

	return host.Uptime()

}
