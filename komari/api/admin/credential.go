package admin

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/auditlog"
	"github.com/komari-monitor/komari/database/credentials"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

func ListCredentials(c *gin.Context) {
	list, err := credentials.List()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "获取凭据失败: "+err.Error())
		return
	}

	// 不返回 SecretEnc
	out := make([]gin.H, 0, len(list))
	for _, it := range list {
		out = append(out, gin.H{
			"id":         it.ID,
			"name":       it.Name,
			"username":   it.Username,
			"type":       it.Type,
			"remark":     it.Remark,
			"created_at": it.CreatedAt,
			"updated_at": it.UpdatedAt,
		})
	}
	api.RespondSuccess(c, out)
}

func CreateCredential(c *gin.Context) {
	var req struct {
		Name     string                `json:"name" binding:"required"`
		Username string                `json:"username" binding:"required"`
		Type     models.CredentialType `json:"type" binding:"required"`
		Secret   string                `json:"secret" binding:"required"`
		Passphrase string              `json:"passphrase"`
		Remark   string                `json:"remark"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	cred, err := credentials.CreateWithPassphrase(req.Name, req.Username, req.Type, req.Secret, req.Passphrase, req.Remark)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	userUUID, _ := c.Get("uuid")
	auditlog.Log(c.ClientIP(), userUUID.(string), "create credential:"+strconv.FormatUint(uint64(cred.ID), 10), "info")
	api.RespondSuccess(c, gin.H{"id": cred.ID})
}

func UpdateCredential(c *gin.Context) {
	id64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的ID")
		return
	}
	var req struct {
		Name     *string                `json:"name"`
		Username *string                `json:"username"`
		Type     *models.CredentialType `json:"type"`
		Secret   *string                `json:"secret"`
		Passphrase *string              `json:"passphrase"`
		Remark   *string                `json:"remark"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	_, err = credentials.Update(uint(id64), req.Name, req.Username, req.Type, req.Secret, req.Remark)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondError(c, http.StatusNotFound, "凭据不存在")
			return
		}
		api.RespondError(c, http.StatusInternalServerError, "更新失败: "+err.Error())
		return
	}
	if req.Passphrase != nil {
		if _, err := credentials.UpdatePassphrase(uint(id64), req.Passphrase); err != nil {
			api.RespondError(c, http.StatusInternalServerError, "更新 passphrase 失败: "+err.Error())
			return
		}
	}
	userUUID, _ := c.Get("uuid")
	auditlog.Log(c.ClientIP(), userUUID.(string), "update credential:"+c.Param("id"), "info")
	api.RespondSuccess(c, gin.H{"updated": true})
}

func DeleteCredential(c *gin.Context) {
	id64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的ID")
		return
	}
	if err := credentials.Delete(uint(id64)); err != nil {
		api.RespondError(c, http.StatusInternalServerError, "删除失败: "+err.Error())
		return
	}
	userUUID, _ := c.Get("uuid")
	auditlog.Log(c.ClientIP(), userUUID.(string), "delete credential:"+c.Param("id"), "warn")
	api.RespondSuccess(c, gin.H{"deleted": true})
}

func RevealCredentialSecret(c *gin.Context) {
	id64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的ID")
		return
	}
	secret, err := credentials.RevealSecret(uint(id64))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondError(c, http.StatusNotFound, "凭据不存在")
			return
		}
		api.RespondError(c, http.StatusInternalServerError, "解密失败: "+err.Error())
		return
	}
	passphrase, err := credentials.RevealPassphrase(uint(id64))
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "解密失败: "+err.Error())
		return
	}
	userUUID, _ := c.Get("uuid")
	auditlog.Log(c.ClientIP(), userUUID.(string), "reveal credential:"+c.Param("id"), "warn")
	api.RespondSuccess(c, gin.H{"secret": secret, "passphrase": passphrase})
}
