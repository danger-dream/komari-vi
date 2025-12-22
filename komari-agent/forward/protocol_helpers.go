package forward

import "strings"

func normalizeProtocol(protocol string) string {
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case "udp":
		return "udp"
	case "both":
		return "tcp"
	default:
		return "tcp"
	}
}

func normalizeProtocols(protocol string) []string {
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case "udp":
		return []string{"udp"}
	case "both":
		return []string{"tcp", "udp"}
	case "tcp":
		return []string{"tcp"}
	default:
		return []string{"tcp"}
	}
}
