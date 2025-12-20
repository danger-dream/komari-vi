package ws

import (
	"net/http"
	"net/url"
	"os"
	"strings"
)

func CheckOrigin(r *http.Request) bool {
	// 直接放行，避免调试/代理环境下的 Origin 403
	if strings.EqualFold(os.Getenv("KOMARI_WS_DISABLE_ORIGIN"), "false") {
		// 如果显式要求校验，再走旧逻辑
		origin := r.Header.Get("Origin")
		if origin == "" {
			return false
		}
		host := r.Host
		originUrl, err := url.Parse(origin)
		if err != nil {
			return false
		}
		return originUrl.Host == host
	}
	return true
}
