package monitoring

import (
	"testing"
)

func TestVirtualized(t *testing.T) {
	virt := Virtualized()
	cpuid_result := detectByCPUID()
	container_result := detectContainer()
	t.Logf("Virtualization type: %s", virt)
	t.Logf("CPUID result: %s", cpuid_result)
	t.Logf("Container result: %s", container_result)
}
