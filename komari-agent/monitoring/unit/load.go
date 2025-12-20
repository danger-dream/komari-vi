package monitoring

import (
	"github.com/shirou/gopsutil/v4/load"
)

type LoadInfo struct {
	Load1  float64 `json:"load_1"`
	Load5  float64 `json:"load_5"`
	Load15 float64 `json:"load_15"`
}

func Load() LoadInfo {

	avg, err := load.Avg()
	if err != nil {
		return LoadInfo{Load1: 0, Load5: 0, Load15: 0}
	}
	return LoadInfo{
		Load1:  avg.Load1,
		Load5:  avg.Load5,
		Load15: avg.Load15,
	}

}
