package securestore

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	envCredentialKey = "KOMARI_CREDENTIAL_KEY"
	keyFilePath      = "./data/secret/credential_key"
)

// GetOrCreateCredentialKey 返回 32 字节主密钥：
// 1) 优先使用 env `KOMARI_CREDENTIAL_KEY`（base64）
// 2) 否则读取 `./data/secret/credential_key`
// 3) 若都没有则生成并落盘
func GetOrCreateCredentialKey() ([]byte, error) {
	if v := strings.TrimSpace(os.Getenv(envCredentialKey)); v != "" {
		key, err := base64.StdEncoding.DecodeString(v)
		if err != nil {
			return nil, fmt.Errorf("%s must be base64: %w", envCredentialKey, err)
		}
		if len(key) != 32 {
			return nil, fmt.Errorf("%s must decode to 32 bytes, got %d", envCredentialKey, len(key))
		}
		return key, nil
	}

	if b, err := os.ReadFile(keyFilePath); err == nil {
		v := strings.TrimSpace(string(b))
		key, err := base64.StdEncoding.DecodeString(v)
		if err != nil {
			return nil, fmt.Errorf("invalid key file %s (expect base64): %w", keyFilePath, err)
		}
		if len(key) != 32 {
			return nil, fmt.Errorf("invalid key length in %s: %d", keyFilePath, len(key))
		}
		return key, nil
	}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	encoded := base64.StdEncoding.EncodeToString(key)
	if err := os.MkdirAll(filepath.Dir(keyFilePath), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyFilePath, []byte(encoded+"\n"), 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

