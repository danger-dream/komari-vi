package forward

// RelayNode 复用主控侧的结构，用于 priority 切换
type RelayNode struct {
	NodeID      string `json:"node_id"`
	Port        string `json:"port"`
	CurrentPort int    `json:"current_port"`
	SortOrder   int    `json:"sort_order"`
}
