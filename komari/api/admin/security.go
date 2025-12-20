package admin

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/database/security"
)

// GET /api/admin/security
func GetSecurityConfig(c *gin.Context) {
	cfg, err := security.GetSecurityConfig()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	// 脱敏 secret
	resp := *cfg
	resp.SignatureSecret = security.MaskedSecret(cfg)
	api.RespondSuccess(c, resp)
}

// POST /api/admin/security
func UpdateSecurityConfig(c *gin.Context) {
	var req models.SecurityConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "参数错误: "+err.Error())
		return
	}
	// 允许逗号分隔的字符串
	if len(req.AllowedOrigins) == 1 {
		if strings.Contains(req.AllowedOrigins[0], ",") {
			req.AllowedOrigins = splitAndTrim(req.AllowedOrigins[0])
		}
	}
	if len(req.AllowedReferers) == 1 {
		if strings.Contains(req.AllowedReferers[0], ",") {
			req.AllowedReferers = splitAndTrim(req.AllowedReferers[0])
		}
	}
	if err := security.UpdateSecurityConfig(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	api.RespondSuccess(c, gin.H{"updated": true})
}

func splitAndTrim(s string) []string {
	parts := strings.Split(s, ",")
	var res []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			res = append(res, p)
		}
	}
	return res
}
