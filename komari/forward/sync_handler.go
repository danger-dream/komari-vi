package forward

import (
	"encoding/json"
	"time"

	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/ws"
)

// ApplyConfigSync 更新规则配置并广播给前端
func ApplyConfigSync(ruleID uint, nodeID string, realmConfig string, updates map[string]interface{}, reason string) error {
	rule, err := dbforward.GetForwardRule(ruleID)
	if err != nil {
		return err
	}

	if len(updates) > 0 {
		var cfg map[string]interface{}
		if err := json.Unmarshal([]byte(rule.ConfigJSON), &cfg); err == nil {
			for k, v := range updates {
				cfg[k] = v
			}
			if b, err := json.Marshal(cfg); err == nil {
				rule.ConfigJSON = string(b)
			}
		}
	}
	if realmConfig != "" {
		rule.RealmConfig = realmConfig
	}
	rule.UpdatedAt = models.FromTime(time.Now())

	if err := dbforward.UpdateForwardRule(ruleID, map[string]interface{}{
		"config_json":  rule.ConfigJSON,
		"realm_config": rule.RealmConfig,
		"updated_at":   rule.UpdatedAt,
	}); err != nil {
		return err
	}

	broadcastConfigUpdated(ruleID, nodeID, reason, updates)
	return nil
}

func broadcastConfigUpdated(ruleID uint, nodeID string, reason string, updates map[string]interface{}) {
	data := map[string]interface{}{
		"event": "forward_config_updated",
		"data": map[string]interface{}{
			"rule_id":   ruleID,
			"node_id":   nodeID,
			"reason":    reason,
			"updates":   updates,
			"timestamp": time.Now().UTC(),
		},
	}
	if b, err := json.Marshal(data); err == nil {
		ws.BroadcastToUsers("forward_config_updated", string(b))
	}
}
