package configs_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// These wiring assertions supplement, not replace, CI's Docker build/start check.
func TestDeploymentUsesThePrimaryGoRuntime(t *testing.T) {
	_, self, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(self), "..", "..", "..")
	read := func(name string) []byte {
		t.Helper()
		raw, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	var compose struct {
		Services map[string]struct {
			Build       struct{ Context, Dockerfile string }
			Command     []string
			Environment map[string]string
			Ports       []string
			Volumes     []string
			Profiles    []string
		}
	}
	if err := yaml.Unmarshal(read("deploy/docker-compose.staging.yml"), &compose); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"api", "migrate", "worker"} {
		service, ok := compose.Services[name]
		if !ok || service.Build.Context != ".." || service.Build.Dockerfile != "server/docker/Dockerfile" {
			t.Fatalf("%s does not build the Go deployment image", name)
		}
		if name != "migrate" && service.Environment["APP_DATABASE_AUTO_MIGRATE"] != "0" {
			t.Fatalf("%s can issue startup DDL", name)
		}
	}
	if strings.Join(compose.Services["migrate"].Command, " ") != "-migrate" || strings.Join(compose.Services["worker"].Command, " ") != "-worker" {
		t.Fatal("deployment commands diverge from the Go CLI")
	}
	api := compose.Services["api"]
	if api.Environment["APP_SERVER_PORT"] != "9090" || api.Environment["APP_UPSTREAM_EXPRESS"] != "off" || api.Environment["APP_EMBEDDED_WORKER_ENABLED"] != "0" || len(api.Ports) != 0 {
		t.Fatal("API port, upstream or worker boundary changed")
	}
	if strings.Join(compose.Services["postgres"].Volumes, ",") != "staging_go_postgres:/var/lib/postgresql/data" {
		t.Fatal("Go must not automatically attach to the old Express PostgreSQL volume")
	}
	if len(compose.Services["worker"].Profiles) == 0 {
		t.Fatal("scanner must remain opt-in")
	}
	var workflow struct {
		Jobs map[string]struct{ Steps []struct{ Uses, Run string } }
	}
	if err := yaml.Unmarshal(read(".github/workflows/ci.yml"), &workflow); err != nil {
		t.Fatal(err)
	}
	if _, ok := workflow.Jobs["go-runtime"]; !ok {
		t.Fatal("Go runtime job missing")
	}
	for name, job := range workflow.Jobs {
		setup := false
		for _, step := range job.Steps {
			if strings.HasPrefix(step.Uses, "actions/setup-go@") {
				setup = true
			}
			if (strings.Contains(step.Run, "test:all") || strings.Contains(step.Run, "test:stability")) && !setup {
				t.Errorf("job %s calls Go through root tests without setup-go", name)
			}
		}
	}
	dockerfile := string(read("server/docker/Dockerfile"))
	for _, required := range []string{"golang:1.25.1-", "CGO_ENABLED=0", "./cmd/server", "EXPOSE 9090", "127.0.0.1:9090/api/v1/health", "USER app"} {
		if !strings.Contains(dockerfile, required) {
			t.Errorf("deployment image missing %q", required)
		}
	}
}
