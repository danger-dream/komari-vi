package forward

// RuleConfig 映射 forward_rules.config_json
type RuleConfig struct {
	Type             string      `json:"type"`
	EntryNodeID      string      `json:"entry_node_id"`
	EntryPort        string      `json:"entry_port"`
	EntryCurrentPort int         `json:"entry_current_port"`
	EntryRealmConfig string      `json:"entry_realm_config"`
	Protocol         string      `json:"protocol"`
	Relays           []RelayNode `json:"relays"`
	Strategy         string      `json:"strategy"`
	ActiveRelayNode  string      `json:"active_relay_node_id"`
	TargetType       string      `json:"target_type"`
	TargetNodeID     string      `json:"target_node_id"`
	TargetHost       string      `json:"target_host"`
	TargetPort       int         `json:"target_port"`
	Hops             []ChainHop  `json:"hops"`
}

type RelayNode struct {
	NodeID      string `json:"node_id"`
	Port        string `json:"port"`
	CurrentPort int    `json:"current_port"`
	RealmConfig string `json:"realm_config"`
	SortOrder   int    `json:"sort_order"`
}

type ChainHop struct {
	Type            string      `json:"type"` // direct / relay_group
	NodeID          string      `json:"node_id"`
	Port            string      `json:"port"`
	CurrentPort     int         `json:"current_port"`
	RealmConfig     string      `json:"realm_config"`
	Relays          []RelayNode `json:"relays"`
	Strategy        string      `json:"strategy"`
	ActiveRelayNode string      `json:"active_relay_node_id"`
	SortOrder       int         `json:"sort_order"`
	TargetType      string      `json:"target_type"`
	TargetNodeID    string      `json:"target_node_id"`
	TargetHost      string      `json:"target_host"`
	TargetPort      int         `json:"target_port"`
}

// NodeResolver 解析 nodeID -> IP/域名
type NodeResolver func(nodeID string) (string, error)
