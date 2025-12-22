package admin

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/clients"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/forward"
)

// GetForwardStats 获取指定规则的监控数据
func GetForwardStats(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	rule, err := dbforward.GetForwardRule(id)
	if err != nil {
		api.RespondError(c, http.StatusNotFound, err.Error())
		return
	}
	stats, err := dbforward.GetForwardStats(id)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	history, _ := forward.GetRecentTrafficHistory(id, "", 300)

	var rc forward.RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	var entryStat *models.ForwardStat
	for i := range stats {
		if stats[i].NodeID == rc.EntryNodeID {
			entryStat = &stats[i]
			break
		}
	}

	resp := gin.H{
		"rule":           rule,
		"stats":          stats,
		"history":        history,
		"entry_status":   entryStat,
		"total_connections": rule.TotalConnections,
		"total_traffic_in":   rule.TotalTrafficIn,
		"total_traffic_out":  rule.TotalTrafficOut,
	}
	api.RespondSuccess(c, resp)
}

type topologyNode struct {
	NodeID   string `json:"node_id"`
	Name     string `json:"name"`
	IP       string `json:"ip"`
	Port     int    `json:"port,omitempty"`
	Status   string `json:"status,omitempty"`
	Latency  int64  `json:"latency_ms,omitempty"`
	Role     string `json:"role"`
}

type topologyHop struct {
	Type             string         `json:"type"`
	Strategy         string         `json:"strategy,omitempty"`
	Node             *topologyNode  `json:"node,omitempty"`
	Relays           []topologyNode `json:"relays,omitempty"`
	ActiveRelayNode  string         `json:"active_relay_node_id,omitempty"`
}

// GetForwardTopology 获取拓扑展示数据
func GetForwardTopology(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	rule, err := dbforward.GetForwardRule(id)
	if err != nil {
		api.RespondError(c, http.StatusNotFound, err.Error())
		return
	}
	stats, _ := dbforward.GetForwardStats(id)
	statMap := map[string]models.ForwardStat{}
	for _, s := range stats {
		statMap[s.NodeID] = s
	}

	var rc forward.RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)

	entry := buildTopologyNode(rc.EntryNodeID, rc.EntryCurrentPort, rc.EntryPort, "entry", statMap)
	hops := make([]topologyHop, 0)
	relays := make([]topologyNode, 0)

	switch rule.Type {
	case "relay_group":
		for _, r := range forward.SortRelays(rc.Relays) {
			relays = append(relays, buildTopologyNode(r.NodeID, r.CurrentPort, r.Port, "relay", statMap))
		}
	case "chain":
		for _, hop := range rc.Hops {
			if strings.ToLower(hop.Type) == "direct" {
				node := buildTopologyNode(hop.NodeID, hop.CurrentPort, hop.Port, "hop", statMap)
				hops = append(hops, topologyHop{Type: hop.Type, Node: &node})
			} else if strings.ToLower(hop.Type) == "relay_group" {
				group := topologyHop{Type: hop.Type, Strategy: hop.Strategy, ActiveRelayNode: hop.ActiveRelayNode}
				for _, r := range forward.SortRelays(hop.Relays) {
					group.Relays = append(group.Relays, buildTopologyNode(r.NodeID, r.CurrentPort, r.Port, "relay", statMap))
				}
				hops = append(hops, group)
			}
		}
	}

	target := topologyNode{Role: "target"}
	if strings.ToLower(rc.TargetType) == "node" && rc.TargetNodeID != "" {
		target = buildTopologyNode(rc.TargetNodeID, 0, "", "target", statMap)
		target.Port = rc.TargetPort
	} else {
		target.Name = rc.TargetHost
		target.IP = rc.TargetHost
		target.Port = rc.TargetPort
	}

	api.RespondSuccess(c, gin.H{
		"rule_id":              rule.ID,
		"type":                 rule.Type,
		"entry":                entry,
		"relays":               relays,
		"hops":                 hops,
		"target":               target,
		"active_relay_node_id": rc.ActiveRelayNode,
	})
}

func buildTopologyNode(nodeID string, current int, spec string, role string, statMap map[string]models.ForwardStat) topologyNode {
	node := topologyNode{
		NodeID: nodeID,
		Role:   role,
	}
	if nodeID == "" {
		return node
	}
	client, err := clients.GetClientByUUID(nodeID)
	if err == nil {
		node.Name = client.Name
		if client.IPv4 != "" {
			node.IP = client.IPv4
		} else {
			node.IP = client.IPv6
		}
	}
	if spec != "" || current > 0 {
		node.Port = forward.ResolvePortFallback(spec, current)
	}
	if stat, ok := statMap[nodeID]; ok {
		node.Status = stat.LinkStatus
		node.Latency = parseLatency(stat.NodesLatency)
	}
	return node
}

func parseLatency(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	var data map[string]int64
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return 0
	}
	if v, ok := data["self"]; ok {
		return v
	}
	for _, v := range data {
		return v
	}
	return 0
}
