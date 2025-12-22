package messageevent

const (
	Offline = "Offline"
	Online  = "Online"
	Expire  = "Expire"
	Renew   = "Renew"
	Login   = "Login"
	Alert   = "Alert"
	Traffic = "Traffic"

	ForwardNodeDown     = "forward_node_down"
	ForwardLinkDegraded = "forward_link_degraded"
	ForwardLinkFaulty   = "forward_link_faulty"
	ForwardHighLatency  = "forward_high_latency"
	ForwardTrafficSpike = "forward_traffic_spike"
)
