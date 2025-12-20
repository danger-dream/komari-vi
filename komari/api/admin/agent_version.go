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

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/agentversion"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

func ListAgentVersions(c *gin.Context) {
	versions, err := agentversion.List()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "获取版本列表失败: "+err.Error())
		return
	}
	api.RespondSuccess(c, versions)
}

func parseBoolInput(v string) bool {
	val, err := strconv.ParseBool(strings.TrimSpace(strings.ToLower(v)))
	if err != nil {
		return false
	}
	return val
}

func parsePackageName(name string) (string, string, error) {
	base := filepath.Base(name)
	base = strings.TrimSuffix(base, filepath.Ext(base))
	if !strings.HasPrefix(base, "komari-agent-") {
		return "", "", fmt.Errorf("文件 %s 不符合命名规范", name)
	}
	rest := strings.TrimPrefix(base, "komari-agent-")
	parts := strings.SplitN(rest, "-", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("文件 %s 不符合 komari-agent-{os}-{arch} 规则", name)
	}
	return parts[0], parts[1], nil
}

func cleanupFiles(paths []string) {
	for _, p := range paths {
		_ = os.Remove(p)
	}
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

func CreateAgentVersion(c *gin.Context) {
	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
		api.RespondError(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	version := strings.TrimSpace(c.PostForm("version"))
	changelog := c.PostForm("changelog")
	isCurrent := parseBoolInput(c.PostForm("is_current"))

	if err := agentversion.ValidateVersionName(version); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	form := c.Request.MultipartForm
	files := form.File["files"]
	if len(files) == 0 {
		api.RespondError(c, http.StatusBadRequest, "请至少上传一个 Agent 文件")
		return
	}
	if err := agentversion.EnsurePackageDir(); err != nil {
		api.RespondError(c, http.StatusInternalServerError, "创建存储目录失败: "+err.Error())
		return
	}
	versionDir := agentversion.VersionDir(version)
	if err := os.MkdirAll(versionDir, os.ModePerm); err != nil {
		api.RespondError(c, http.StatusInternalServerError, "创建版本目录失败: "+err.Error())
		return
	}
	var saved []string
	pkgs := make([]models.AgentPackage, 0, len(files))
	for _, f := range files {
		osName, arch, err := parsePackageName(f.Filename)
		if err != nil {
			cleanupFiles(saved)
			api.RespondError(c, http.StatusBadRequest, err.Error())
			return
		}
		fileName := filepath.Base(f.Filename)
		dst := filepath.Join(versionDir, fileName)
		size, hash, err := saveUploadedFileWithHash(f, dst)
		if err != nil {
			cleanupFiles(saved)
			api.RespondError(c, http.StatusInternalServerError, "保存文件失败: "+err.Error())
			return
		}
		saved = append(saved, dst)
		pkgs = append(pkgs, models.AgentPackage{
			OS:       osName,
			Arch:     arch,
			FileName: fileName,
			FileSize: size,
			Hash:     hash,
		})
	}

	versionInfo, err := agentversion.CreateVersion(version, changelog, isCurrent, pkgs)
	if err != nil {
		cleanupFiles(saved)
		api.RespondError(c, http.StatusInternalServerError, "创建版本失败: "+err.Error())
		return
	}
	api.RespondSuccessMessage(c, "创建成功", versionInfo)
}

func UploadAgentPackages(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的版本ID")
		return
	}
	version, err := agentversion.GetVersionByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondError(c, http.StatusNotFound, "版本不存在")
			return
		}
		api.RespondError(c, http.StatusInternalServerError, "获取版本失败: "+err.Error())
		return
	}
	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
		api.RespondError(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	files := c.Request.MultipartForm.File["files"]
	if len(files) == 0 {
		api.RespondError(c, http.StatusBadRequest, "请上传至少一个文件")
		return
	}
	versionDir := agentversion.VersionDir(version.Version)
	if err := os.MkdirAll(versionDir, os.ModePerm); err != nil {
		api.RespondError(c, http.StatusInternalServerError, "创建版本目录失败: "+err.Error())
		return
	}
	var saved []string
	for _, f := range files {
		osName, arch, err := parsePackageName(f.Filename)
		if err != nil {
			cleanupFiles(saved)
			api.RespondError(c, http.StatusBadRequest, err.Error())
			return
		}
		fileName := filepath.Base(f.Filename)
		dst := filepath.Join(versionDir, fileName)
		old, _ := agentversion.GetPackageByPlatform(version.ID, osName, arch)
		size, hash, err := saveUploadedFileWithHash(f, dst)
		if err != nil {
			cleanupFiles(saved)
			api.RespondError(c, http.StatusInternalServerError, "保存文件失败: "+err.Error())
			return
		}
		saved = append(saved, dst)
		if err := agentversion.UpsertPackage(models.AgentPackage{
			VersionID: version.ID,
			OS:        osName,
			Arch:      arch,
			FileName:  fileName,
			FileSize:  size,
			Hash:      hash,
		}); err != nil {
			cleanupFiles(saved)
			api.RespondError(c, http.StatusInternalServerError, "写入数据库失败: "+err.Error())
			return
		}
		if old != nil && old.FileName != fileName {
			_ = os.Remove(filepath.Join(versionDir, old.FileName))
		}
	}
	updated, _ := agentversion.GetVersionByID(uint(id))
	api.RespondSuccessMessage(c, "上传成功", updated)
}

func UpdateAgentVersionMetadata(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的版本ID")
		return
	}
	var req struct {
		Version   *string `json:"version"`
		Changelog *string `json:"changelog"`
		IsCurrent *bool   `json:"is_current"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "参数错误: "+err.Error())
		return
	}

	// 如果要更新版本号，需要先验证并重命名目录
	if req.Version != nil {
		oldVersion, err := agentversion.GetVersionByID(uint(id))
		if err != nil {
			api.RespondError(c, http.StatusInternalServerError, "获取版本失败: "+err.Error())
			return
		}
		newVersion := strings.TrimSpace(*req.Version)
		if err := agentversion.ValidateVersionName(newVersion); err != nil {
			api.RespondError(c, http.StatusBadRequest, err.Error())
			return
		}
		if newVersion != oldVersion.Version {
			oldDir := agentversion.VersionDir(oldVersion.Version)
			newDir := agentversion.VersionDir(newVersion)
			if err := os.Rename(oldDir, newDir); err != nil {
				api.RespondError(c, http.StatusInternalServerError, "重命名目录失败: "+err.Error())
				return
			}
		}
	}

	version, err := agentversion.UpdateMetadata(uint(id), req.Version, req.Changelog, req.IsCurrent)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "更新失败: "+err.Error())
		return
	}
	api.RespondSuccess(c, version)
}

func DeleteAgentVersion(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的版本ID")
		return
	}
	// 检查是否为当前版本
	version, err := agentversion.GetVersionByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondError(c, http.StatusNotFound, "版本不存在")
			return
		}
		api.RespondError(c, http.StatusInternalServerError, "获取版本失败: "+err.Error())
		return
	}
	if version.IsCurrent {
		api.RespondError(c, http.StatusBadRequest, "不能删除当前版本")
		return
	}
	if err := agentversion.DeleteVersion(uint(id)); err != nil {
		api.RespondError(c, http.StatusInternalServerError, "删除失败: "+err.Error())
		return
	}
	api.RespondSuccessMessage(c, "删除成功", nil)
}

func DeleteAgentPackage(c *gin.Context) {
	versionID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的版本ID")
		return
	}
	packageID, err := strconv.ParseUint(c.Param("package_id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的包ID")
		return
	}
	// 验证包属于该版本
	pkg, err := agentversion.GetPackageByID(uint(packageID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondError(c, http.StatusNotFound, "包不存在")
			return
		}
		api.RespondError(c, http.StatusInternalServerError, "获取包失败: "+err.Error())
		return
	}
	if pkg.VersionID != uint(versionID) {
		api.RespondError(c, http.StatusBadRequest, "包不属于该版本")
		return
	}
	if err := agentversion.DeletePackage(uint(packageID)); err != nil {
		api.RespondError(c, http.StatusInternalServerError, "删除失败: "+err.Error())
		return
	}
	api.RespondSuccessMessage(c, "删除成功", nil)
}

func DownloadAgentPackage(c *gin.Context) {
	versionID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的版本ID")
		return
	}
	packageID, err := strconv.ParseUint(c.Param("package_id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的包ID")
		return
	}
	// 验证包属于该版本
	pkg, err := agentversion.GetPackageByID(uint(packageID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondError(c, http.StatusNotFound, "包不存在")
			return
		}
		api.RespondError(c, http.StatusInternalServerError, "获取包失败: "+err.Error())
		return
	}
	if pkg.VersionID != uint(versionID) {
		api.RespondError(c, http.StatusBadRequest, "包不属于该版本")
		return
	}
	// 获取版本信息
	version, err := agentversion.GetVersionByID(uint(versionID))
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "获取版本失败: "+err.Error())
		return
	}
	// 构建文件路径
	filePath := filepath.Join(agentversion.VersionDir(version.Version), pkg.FileName)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		api.RespondError(c, http.StatusNotFound, "文件不存在")
		return
	}
	c.FileAttachment(filePath, pkg.FileName)
}
