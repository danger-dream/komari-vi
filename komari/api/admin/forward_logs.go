package admin

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/clients"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/forward"
)

// ListForwardLogs 获取规则涉及节点列表
func ListForwardLogs(c *gin.Context) {
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
	nodeIDs := collectRuleNodes(rule)
	nodes := make([]gin.H, 0, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		entry := gin.H{"node_id": nodeID}
		if client, err := clients.GetClientByUUID(nodeID); err == nil {
			entry["node_name"] = client.Name
		}
		nodes = append(nodes, entry)
	}
	api.RespondSuccess(c, nodes)
}

// GetForwardLog 获取指定节点日志
func GetForwardLog(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	nodeID := strings.TrimSpace(c.Param("nodeId"))
	if nodeID == "" {
		api.RespondError(c, http.StatusBadRequest, "nodeId is required")
		return
	}
	lines, _ := strconv.Atoi(c.DefaultQuery("lines", "200"))
	if lines <= 0 {
		lines = 200
	}
	res, err := forward.SendTaskToNode(nodeID, forward.TaskGetRealmLog, forward.GetRealmLogRequest{
		RuleID: id,
		NodeID: nodeID,
		Lines:  lines,
	}, 15*time.Second)
	if err != nil && res.Message == "" {
		res.Message = err.Error()
	}
	api.RespondSuccess(c, res)
}

// DeleteForwardLog 删除指定节点日志
func DeleteForwardLog(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	nodeID := strings.TrimSpace(c.Param("nodeId"))
	if nodeID == "" {
		api.RespondError(c, http.StatusBadRequest, "nodeId is required")
		return
	}
	res, err := forward.SendTaskToNode(nodeID, forward.TaskDeleteRealmLog, forward.DeleteRealmLogRequest{
		RuleID: id,
		NodeID: nodeID,
	}, 15*time.Second)
	if err != nil && res.Message == "" {
		res.Message = err.Error()
	}
	api.RespondSuccess(c, res)
}

// ClearForwardLog 清空指定节点日志
func ClearForwardLog(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	nodeID := strings.TrimSpace(c.Param("nodeId"))
	if nodeID == "" {
		api.RespondError(c, http.StatusBadRequest, "nodeId is required")
		return
	}
	res, err := forward.SendTaskToNode(nodeID, forward.TaskClearRealmLog, forward.ClearRealmLogRequest{
		RuleID: id,
		NodeID: nodeID,
	}, 15*time.Second)
	if err != nil && res.Message == "" {
		res.Message = err.Error()
	}
	api.RespondSuccess(c, res)
}

func collectRuleNodes(rule *models.ForwardRule) []string {
	var rc forward.RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	set := map[string]struct{}{}
	if rc.EntryNodeID != "" {
		set[rc.EntryNodeID] = struct{}{}
	}
	switch strings.ToLower(rule.Type) {
	case "relay_group":
		for _, r := range rc.Relays {
			set[r.NodeID] = struct{}{}
		}
	case "chain":
		for _, hop := range rc.Hops {
			if strings.ToLower(hop.Type) == "direct" && hop.NodeID != "" {
				set[hop.NodeID] = struct{}{}
			}
			if strings.ToLower(hop.Type) == "relay_group" {
				for _, r := range hop.Relays {
					set[r.NodeID] = struct{}{}
				}
			}
		}
	}
	nodes := make([]string, 0, len(set))
	for k := range set {
		nodes = append(nodes, k)
	}
	return nodes
}
