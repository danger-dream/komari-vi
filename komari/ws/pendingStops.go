package ws

import "sync"

type PendingStop struct {
	ScriptID uint   `json:"script_id"`
	ExecID   string `json:"exec_id"`
}

var (
	pendingStops   = make(map[string][]PendingStop)
	pendingStopsMu sync.Mutex
)

func AddPendingStop(clientID string, stop PendingStop) {
	if clientID == "" || stop.ExecID == "" || stop.ScriptID == 0 {
		return
	}
	pendingStopsMu.Lock()
	defer pendingStopsMu.Unlock()
	pendingStops[clientID] = append(pendingStops[clientID], stop)
}

func DrainPendingStops(clientID string) []PendingStop {
	pendingStopsMu.Lock()
	defer pendingStopsMu.Unlock()
	stops := pendingStops[clientID]
	delete(pendingStops, clientID)
	return stops
}
