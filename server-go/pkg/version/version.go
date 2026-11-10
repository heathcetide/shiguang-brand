// Package version provides build-time and runtime version information.
//
// The default values can be overridden at link time with -ldflags:
//
//	-ldflags "-X github.com/LingByte/ling-base/version.Version=1.0.0"
//
// When not overridden, GitCommit and BuildTime are resolved automatically
// from VCS build info (Go 1.18+) or the local git repository.
package version

// Version is the semantic version string.
var Version = "1.0.0"

// GitCommit is the short Git commit hash.
var GitCommit = "unknown"

// BuildTime is the build timestamp (RFC3339).
var BuildTime = "unknown"

// GoVersion is the Go toolchain version used to build.
var GoVersion = "unknown"

// GetVersion returns the version string.
func GetVersion() string {
	return Version
}

// GetVersionInfo returns a human-readable version summary.
func GetVersionInfo() string {
	return Version + " (commit: " + GitCommit + ", built at: " + BuildTime + ", go: " + GoVersion + ")"
}

// GetGitCommit returns the Git commit hash.
func GetGitCommit() string {
	return GitCommit
}

// GetBuildTime returns the build timestamp.
func GetBuildTime() string {
	return BuildTime
}

// GetGoVersion returns the Go version.
func GetGoVersion() string {
	return GoVersion
}
