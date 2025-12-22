package oauth

import (
	"testing"

	"github.com/komari-monitor/komari/utils/oauth/factory"
)

// Test function
func TestRegisterAndGetProviderConfigs(t *testing.T) {
	All()
	configs := factory.GetProviderConfigs()
	if len(configs) == 0 {
		t.Error("Expected non-empty provider configs, got empty")
	}
	providers := factory.GetAllOidcProviders()
	if len(providers) == 0 {
		t.Error("Expected non-empty OIDC providers, got empty")
	}
	names := factory.GetAllOidcProviderNames()
	if len(names) == 0 {
		t.Error("Expected non-empty OIDC provider names, got empty")
	}

	if err := LoadProvider("github", `{"client_id":"test_id","client_secret":"test_secret"}`); err != nil {
		t.Fatalf("Failed to load provider: %v", err)
	}
	if CurrentProvider() == nil || CurrentProvider().GetConfiguration() == nil {
		t.Error("Expected non-nil current provider configuration")
	}
}
