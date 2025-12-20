package update

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/blang/semver"
	goupdate "github.com/inconshreveable/go-update"
	pkg_flags "github.com/komari-monitor/komari-agent/cmd/flags"
	"github.com/komari-monitor/komari-agent/dnsresolver"
)

var (
	CurrentVersion string = "0.0.0"
	Repo           string = "komari-monitor/komari-agent"
)

type agentUpdateData struct {
	HasUpdate    bool   `json:"has_update"`
	Version      string `json:"version"`
	IsCurrent    bool   `json:"is_current"`
	Changelog    string `json:"changelog"`
	PackageID    uint   `json:"package_id"`
	DownloadPath string `json:"download_path"`
	OS           string `json:"os"`
	Arch         string `json:"arch"`
	Hash         string `json:"hash"`
	FileSize     int64  `json:"file_size"`
}

// parseVersion 解析可能带有 v/V 前缀，以及预发布或构建元数据的版本字符串
func parseVersion(ver string) (semver.Version, error) {
	ver = strings.TrimPrefix(ver, "v")
	ver = strings.TrimPrefix(ver, "V")
	return semver.ParseTolerant(ver)
}

func normalizeVersion(ver string) string {
	v, err := parseVersion(ver)
	if err != nil {
		return strings.TrimSpace(ver)
	}
	return v.String()
}

func DoUpdateWorks() {
	ticker_ := time.NewTicker(30 * time.Minute)
	for range ticker_.C {
		CheckAndUpdate()
	}
}

func buildDownloadURL(endpoint, path, token string) string {
	if path == "" {
		return ""
	}
	base := strings.TrimRight(endpoint, "/")
	full := base + path
	if strings.Contains(full, "?") {
		return full + "&token=" + url.QueryEscape(token)
	}
	return full + "?token=" + url.QueryEscape(token)
}

// 检查更新并执行自动更新
func CheckAndUpdate() error {
	cfg := pkg_flags.GlobalConfig
	if cfg == nil || cfg.Endpoint == "" || cfg.Token == "" {
		return nil
	}

	log.Println("Checking update from server...")
	client := dnsresolver.GetHTTPClient(60 * time.Second)

	query := url.Values{}
	query.Set("token", cfg.Token)
	query.Set("current_version", CurrentVersion)
	query.Set("os", runtime.GOOS)
	query.Set("arch", runtime.GOARCH)
	updateURL := strings.TrimRight(cfg.Endpoint, "/") + "/api/clients/update?" + query.Encode()

	resp, err := client.Get(updateURL)
	if err != nil {
		return fmt.Errorf("failed to request update info: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("update check failed: status=%d, body=%s", resp.StatusCode, string(body))
	}
	var payload struct {
		Status  string          `json:"status"`
		Message string          `json:"message"`
		Data    agentUpdateData `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return fmt.Errorf("failed to parse update response: %w", err)
	}
	if payload.Status != "success" {
		return fmt.Errorf("update endpoint error: %s", payload.Message)
	}

	data := payload.Data
	targetVersion := normalizeVersion(data.Version)
	current := normalizeVersion(CurrentVersion)
	if !data.IsCurrent || targetVersion == "" {
		log.Println("No current version published by server, skip update")
		return nil
	}
	if targetVersion == current {
		log.Println("Agent 已是最新版本:", data.Version)
		return nil
	}
	if !data.HasUpdate {
		log.Println("服务器未要求更新，跳过")
		return nil
	}

	downloadURL := buildDownloadURL(cfg.Endpoint, data.DownloadPath, cfg.Token)
	if downloadURL == "" {
		return fmt.Errorf("缺少可用的下载地址")
	}
	if err := applyUpdate(downloadURL, client, data.Version, data.Hash, data.FileSize); err != nil {
		return err
	}
	return nil
}

func applyUpdate(downloadURL string, client *http.Client, targetVersion, expectedHash string, expectedSize int64) error {
	resp, err := client.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("failed to download update: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("download failed: status=%d, body=%s", resp.StatusCode, string(body))
	}
	tmp, err := os.CreateTemp("", "komari-agent-update-*")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tmp.Name())

	hasher := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, hasher), resp.Body)
	if err != nil {
		return fmt.Errorf("failed to save update file: %w", err)
	}
	if expectedSize > 0 && size != expectedSize {
		return fmt.Errorf("downloaded size mismatch: got %d expect %d", size, expectedSize)
	}
	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if expectedHash != "" && !strings.EqualFold(actualHash, expectedHash) {
		return fmt.Errorf("checksum mismatch: got %s expect %s", actualHash, expectedHash)
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("failed to rewind temp file: %w", err)
	}
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	execPath, _ = filepath.Abs(execPath)
	if err := goupdate.Apply(tmp, goupdate.Options{TargetPath: execPath}); err != nil {
		if rerr := goupdate.RollbackError(err); rerr != nil {
			return fmt.Errorf("update failed: %v, rollback failed: %v", err, rerr)
		}
		return fmt.Errorf("update failed: %w", err)
	}
	log.Printf("Successfully updated to version %s, restarting...\n", targetVersion)
	os.Exit(42)
	return nil
}
