package monitoring

import "testing"

func TestOsName(t *testing.T) {
	if got := OSName(); got == "" {
		t.Errorf("OSName() = %v, want non-empty string", got)
	} else {
		t.Logf("OSName() = %v", got)
	}
}
