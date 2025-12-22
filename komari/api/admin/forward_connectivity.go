package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/clients"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/forward"
)

type connectivityRequest struct {
	RuleID     uint   `json:"rule_id"`
	ConfigJSON string `json:"config_json"`
	Timeout    int    `json:"timeout"`
}

type connectivityStep struct {
	Step      string `json:"step"`
	NodeID    string `json:"node_id"`
	Target    string `json:"target"`
	Success   bool   `json:"success"`
	LatencyMs *int64 `json:"latency_ms,omitempty"`
	Message   string `json:"message,omitempty"`
}

// TestConnectivity 测试链路连通性
func TestConnectivity(c *gin.Context) {
	var req connectivityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.Timeout <= 0 {
		req.Timeout = 5
	}
	cfgJSON := req.ConfigJSON
	if cfgJSON == "" && req.RuleID > 0 {
		rule, err := dbforward.GetForwardRule(req.RuleID)
		if err != nil {
			api.RespondError(c, http.StatusNotFound, err.Error())
			return
		}
		cfgJSON = rule.ConfigJSON
	}
	if cfgJSON == "" {
		api.RespondError(c, http.StatusBadRequest, "config_json is required")
		return
	}

	var cfg forward.RuleConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		api.RespondError(c, http.StatusBadRequest, "invalid config_json")
		return
	}

	steps := buildConnectivitySteps(cfg)
	results := make([]connectivityStep, 0, len(steps))
	for _, step := range steps {
		if step.NodeID == "" || step.Target == "" {
			continue
		}
		host, port, err := splitTarget(step.Target)
		if err != nil {
			step.Success = false
			step.Message = err.Error()
			results = append(results, step)
			continue
		}
		res, err := forward.SendTaskToNode(step.NodeID, forward.TaskTestConnectivity, forward.TestConnectivityRequest{
			TargetHost: host,
			TargetPort: port,
			Timeout:    req.Timeout,
		}, time.Duration(req.Timeout+2)*time.Second)
		if err != nil && res.Message == "" {
			res.Message = err.Error()
		}
		step.Success = res.Success
		step.Message = res.Message
		if len(res.Payload) > 0 {
			var payload forward.TestConnectivityResponse
			if e := json.Unmarshal(res.Payload, &payload); e == nil {
				step.Success = payload.Success
				step.LatencyMs = payload.LatencyMs
				if payload.Message != "" {
					step.Message = payload.Message
				}
			}
		}
		results = append(results, step)
	}
	api.RespondSuccess(c, gin.H{"steps": results})
}

func buildConnectivitySteps(cfg forward.RuleConfig) []connectivityStep {
	steps := []connectivityStep{}
	targetHost, targetPort := resolveTarget(cfg)

	// Step 1: entry -> next hop
	if cfg.EntryNodeID != "" {
		nextHost, nextPort := resolveEntryNextHop(cfg)
		if nextHost != "" && nextPort > 0 {
			steps = append(steps, connectivityStep{
				Step:   "entry_reach",
				NodeID: cfg.EntryNodeID,
				Target: fmt.Sprintf("%s:%d", nextHost, nextPort),
			})
		}
	}

	// Step 2: relay/hop nodes -> next hop
	if strings.ToLower(cfg.Type) == "relay_group" {
		for _, r := range forward.SortRelays(cfg.Relays) {
			host, _ := resolveNodeIP(r.NodeID)
			port := forward.ResolvePortFallback(r.Port, r.CurrentPort)
			if host != "" && port > 0 && targetHost != "" {
				steps = append(steps, connectivityStep{
					Step:   "relay_reach",
					NodeID: r.NodeID,
					Target: fmt.Sprintf("%s:%d", targetHost, targetPort),
				})
			}
		}
	}
	if strings.ToLower(cfg.Type) == "chain" {
		for i, hop := range cfg.Hops {
			nextHost, nextPort := resolveHopNext(cfg, i)
			if nextHost == "" || nextPort == 0 {
				continue
			}
			if strings.ToLower(hop.Type) == "direct" {
				steps = append(steps, connectivityStep{
					Step:   "hop_reach",
					NodeID: hop.NodeID,
					Target: fmt.Sprintf("%s:%d", nextHost, nextPort),
				})
			} else if strings.ToLower(hop.Type) == "relay_group" {
				for _, r := range forward.SortRelays(hop.Relays) {
					steps = append(steps, connectivityStep{
						Step:   "hop_reach",
						NodeID: r.NodeID,
						Target: fmt.Sprintf("%s:%d", nextHost, nextPort),
					})
				}
			}
		}
	}

	// Step 3: last hop -> target
	if targetHost != "" && targetPort > 0 {
		lastNode := resolveLastHopNode(cfg)
		if lastNode != "" {
			steps = append(steps, connectivityStep{
				Step:   "target_reach",
				NodeID: lastNode,
				Target: fmt.Sprintf("%s:%d", targetHost, targetPort),
			})
		}
	}

	// Step 4: entry -> target (end-to-end)
	if cfg.EntryNodeID != "" && targetHost != "" && targetPort > 0 {
		steps = append(steps, connectivityStep{
			Step:   "end_to_end",
			NodeID: cfg.EntryNodeID,
			Target: fmt.Sprintf("%s:%d", targetHost, targetPort),
		})
	}
	return steps
}

func resolveTarget(cfg forward.RuleConfig) (string, int) {
	if strings.ToLower(cfg.TargetType) == "node" {
		host, _ := resolveNodeIP(cfg.TargetNodeID)
		return host, cfg.TargetPort
	}
	return cfg.TargetHost, cfg.TargetPort
}

func resolveEntryNextHop(cfg forward.RuleConfig) (string, int) {
	if strings.ToLower(cfg.Type) == "direct" {
		return resolveTarget(cfg)
	}
	if strings.ToLower(cfg.Type) == "relay_group" {
		nodeID := cfg.ActiveRelayNode
		if nodeID == "" && len(cfg.Relays) > 0 {
			nodeID = forward.SortRelays(cfg.Relays)[0].NodeID
		}
		host, _ := resolveNodeIP(nodeID)
		var port int
		for _, r := range cfg.Relays {
			if r.NodeID == nodeID {
				port = forward.ResolvePortFallback(r.Port, r.CurrentPort)
				break
			}
		}
		return host, port
	}
	if strings.ToLower(cfg.Type) == "chain" && len(cfg.Hops) > 0 {
		return resolveHopTarget(cfg.Hops[0])
	}
	return "", 0
}

func resolveHopTarget(hop forward.ChainHop) (string, int) {
	if strings.ToLower(hop.Type) == "direct" {
		host, _ := resolveNodeIP(hop.NodeID)
		return host, forward.ResolvePortFallback(hop.Port, hop.CurrentPort)
	}
	if strings.ToLower(hop.Type) == "relay_group" && len(hop.Relays) > 0 {
		active := hop.ActiveRelayNode
		if active == "" {
			active = forward.SortRelays(hop.Relays)[0].NodeID
		}
		host, _ := resolveNodeIP(active)
		var port int
		for _, r := range hop.Relays {
			if r.NodeID == active {
				port = forward.ResolvePortFallback(r.Port, r.CurrentPort)
				break
			}
		}
		return host, port
	}
	return "", 0
}

func resolveHopNext(cfg forward.RuleConfig, hopIndex int) (string, int) {
	if hopIndex+1 < len(cfg.Hops) {
		return resolveHopTarget(cfg.Hops[hopIndex+1])
	}
	return resolveTarget(cfg)
}

func resolveLastHopNode(cfg forward.RuleConfig) string {
	if strings.ToLower(cfg.Type) == "direct" {
		return cfg.EntryNodeID
	}
	if strings.ToLower(cfg.Type) == "relay_group" && len(cfg.Relays) > 0 {
		return forward.SortRelays(cfg.Relays)[0].NodeID
	}
	if strings.ToLower(cfg.Type) == "chain" && len(cfg.Hops) > 0 {
		last := cfg.Hops[len(cfg.Hops)-1]
		if strings.ToLower(last.Type) == "direct" {
			return last.NodeID
		}
		if strings.ToLower(last.Type) == "relay_group" && len(last.Relays) > 0 {
			return forward.SortRelays(last.Relays)[0].NodeID
		}
	}
	return cfg.EntryNodeID
}

func resolveNodeIP(nodeID string) (string, error) {
	cli, err := clients.GetClientByUUID(nodeID)
	if err != nil {
		return "", err
	}
	if ip := strings.TrimSpace(cli.IPv4); ip != "" {
		return ip, nil
	}
	if ip := strings.TrimSpace(cli.IPv6); ip != "" {
		return ip, nil
	}
	return "", fmt.Errorf("node %s has no IP", nodeID)
}

func splitTarget(target string) (string, int, error) {
	parts := strings.Split(target, ":")
	if len(parts) < 2 {
		return "", 0, fmt.Errorf("invalid target: %s", target)
	}
	host := strings.Join(parts[:len(parts)-1], ":")
	portStr := parts[len(parts)-1]
	port := forward.ResolvePortFallback(portStr, 0)
	if port <= 0 {
		return "", 0, fmt.Errorf("invalid port: %s", target)
	}
	return host, port, nil
}
