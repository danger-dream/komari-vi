package admin

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

const realmBinaryBaseDir = "./realm-binaries"

func ListRealmBinaries(c *gin.Context) {
	items, err := dbforward.ListRealmBinaries()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, items)
}

func UploadRealmBinary(c *gin.Context) {
	if err := c.Request.ParseMultipartForm(64 << 20); err != nil {
		api.RespondError(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	osName := strings.TrimSpace(c.PostForm("os"))
	arch := strings.TrimSpace(c.PostForm("arch"))
	version := strings.TrimSpace(c.PostForm("version"))
	isDefault, _ := strconv.ParseBool(strings.TrimSpace(c.PostForm("is_default")))
	if osName == "" || arch == "" || version == "" {
		api.RespondError(c, http.StatusBadRequest, "os/arch/version 必填")
		return
	}
	if strings.Contains(version, "..") || strings.ContainsAny(version, "/\\") {
		api.RespondError(c, http.StatusBadRequest, "version 含非法字符")
		return
	}
	exists, err := dbforward.ExistsRealmBinary(osName, arch, version)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	if exists {
		api.RespondError(c, http.StatusBadRequest, "该平台版本已存在")
		return
	}
	fileHeader := firstFile(c.Request.MultipartForm.File)
	if fileHeader == nil {
		api.RespondError(c, http.StatusBadRequest, "缺少上传文件")
		return
	}
	if err := os.MkdirAll(realmBinaryBaseDir, os.ModePerm); err != nil {
		api.RespondError(c, http.StatusInternalServerError, "创建目录失败: "+err.Error())
		return
	}
	fileName := fmt.Sprintf("realm-%s-%s-%s%s", strings.ToLower(osName), strings.ToLower(arch), version, filepath.Ext(fileHeader.Filename))
	dst := filepath.Join(realmBinaryBaseDir, fileName)
	size, hash, err := saveUploadedFileWithHash(fileHeader, dst)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "保存文件失败: "+err.Error())
		return
	}
	item := models.RealmBinary{
		OS:         osName,
		Arch:       arch,
		Version:    version,
		FilePath:   dst,
		FileSize:   size,
		FileHash:   hash,
		IsDefault:  isDefault,
		UploadedAt: models.FromTime(time.Now()),
	}
	if err := dbforward.CreateRealmBinary(&item); err != nil {
		_ = os.Remove(dst)
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	if isDefault {
		_ = dbforward.SetRealmBinaryDefault(item.ID)
	}
	api.RespondSuccess(c, item)
}

func DeleteRealmBinary(c *gin.Context) {
	id64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效ID")
		return
	}
	item, err := dbforward.GetRealmBinary(uint(id64))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondError(c, http.StatusNotFound, "记录不存在")
			return
		}
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := dbforward.DeleteRealmBinary(item.ID); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	_ = os.Remove(item.FilePath)
	api.RespondSuccess(c, gin.H{"deleted": true})
}

func DownloadRealmBinary(c *gin.Context) {
	id64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效ID")
		return
	}
	item, err := dbforward.GetRealmBinary(uint(id64))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondError(c, http.StatusNotFound, "记录不存在")
			return
		}
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	if item.FilePath == "" {
		api.RespondError(c, http.StatusNotFound, "文件不存在")
		return
	}
	if _, err := os.Stat(item.FilePath); err != nil {
		api.RespondError(c, http.StatusNotFound, "文件不存在")
		return
	}
	c.FileAttachment(item.FilePath, filepath.Base(item.FilePath))
}

func firstFile(files map[string][]*multipart.FileHeader) *multipart.FileHeader {
	for _, list := range files {
		if len(list) > 0 {
			return list[0]
		}
	}
	return nil
}

func saveUploadedFileWithHash(f *multipart.FileHeader, dst string) (int64, string, error) {
	src, err := f.Open()
	if err != nil {
		return 0, "", err
	}
	defer src.Close()
	out, err := os.Create(dst)
	if err != nil {
		return 0, "", err
	}
	defer out.Close()
	hasher := sha256.New()
	size, err := io.Copy(io.MultiWriter(out, hasher), src)
	if err != nil {
		return 0, "", err
	}
	return size, fmt.Sprintf("%x", hasher.Sum(nil)), nil
}
