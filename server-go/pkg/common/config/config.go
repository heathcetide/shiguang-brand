// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package config provides a multi-format, multi-environment configuration
// loader. It supports YAML and .env files with environment-specific
// overrides (e.g. config.yaml + config.dev.yaml).
//
// # Design
//
// Configurations are loaded in layers, each layer overriding the previous:
//
//  1. Base file:     config.yaml  (or config.env)
//  2. Env file:      config.<env>.yaml  (e.g. config.dev.yaml)
//  3. OS env vars:   override individual keys via struct tags
//
// # File layout
//
//	config/
//	├── config.yaml         # base config (all environments)
//	├── config.dev.yaml     # dev overrides
//	├── config.prod.yaml    # prod overrides
//	└── config.test.yaml    # test overrides
//
// Or using .env format:
//
//	config/
//	├── config.env          # base
//	├── config.dev.env      # dev overrides
//
// # Quick start
//
//	type AppCfg struct {
//	    Server struct {
//	        Port int `yaml:"port" env:"SERVER_PORT"`
//	    } `yaml:"server"`
//	    DB struct {
//	        DSN string `yaml:"dsn" env:"DSN"`
//	    } `yaml:"db"`
//	}
//
//	// Load from ./config/config.yaml + config.dev.yaml + OS env
//	var cfg AppCfg
//	err := config.Load("config/", "dev", &cfg)
//	if err != nil { log.Fatal(err) }
//
//	// Or use the Builder API for fine-grained control
//	cfg, err := config.New().
//	    Dir("config/").
//	    Env("dev").
//	    LoadInto(&AppCfg{})
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Format is the configuration file format.
type Format int

const (
	// FormatAuto auto-detects from file extension (.yaml/.yml → YAML, .env → ENV).
	FormatAuto Format = iota
	// FormatYAML forces YAML parsing.
	FormatYAML
	// FormatENV forces .env parsing.
	FormatENV
)

// String returns the format name.
func (f Format) String() string {
	switch f {
	case FormatYAML:
		return "yaml"
	case FormatENV:
		return "env"
	default:
		return "auto"
	}
}

// ============================================================
// Loader
// ============================================================

// Loader is the main configuration loader. Use New() to create one.
type Loader struct {
	dir       string // config directory
	env       string // environment name (dev/prod/test/...)
	baseName  string // base filename without extension (default: "config")
	format    Format // file format
	envVars   bool   // whether to apply OS env var overrides
	overwrite bool   // whether to os.Setenv for env-format values
}

// New creates a new Loader with sensible defaults:
//   - dir: "config/"
//   - baseName: "config"
//   - format: auto-detect
//   - envVars: true (OS env overrides take precedence)
func New() *Loader {
	return &Loader{
		dir:      "config/",
		baseName: "config",
		format:   FormatAuto,
		envVars:  true,
	}
}

// Dir sets the config directory.
func (l *Loader) Dir(dir string) *Loader {
	l.dir = dir
	return l
}

// Env sets the environment name (e.g. "dev", "prod", "test").
// When set, the loader looks for config.<env>.yaml as an override layer.
func (l *Loader) Env(env string) *Loader {
	l.env = env
	return l
}

// BaseName sets the base filename without extension (default: "config").
func (l *Loader) BaseName(name string) *Loader {
	l.baseName = name
	return l
}

// Format sets the file format (default: auto-detect).
func (l *Loader) Format(f Format) *Loader {
	l.format = f
	return l
}

// WithEnvVars enables/disables OS env var overrides (default: enabled).
func (l *Loader) WithEnvVars(enabled bool) *Loader {
	l.envVars = enabled
	return l
}

// OverwriteEnvVars controls whether .env file values are written to os.Environ
// via os.Setenv (default: false). Useful for making values visible to
// libraries that read env vars directly.
func (l *Loader) OverwriteEnvVars(enabled bool) *Loader {
	l.overwrite = enabled
	return l
}

// Load loads configuration into the given struct pointer.
// It applies layers in order: base file → env-specific file → OS env vars.
func (l *Loader) Load(out any) error {
	if out == nil {
		return fmt.Errorf("config: output is nil")
	}

	// Resolve format and find files.
	format := l.format
	if format == FormatAuto {
		format = l.detectFormat()
	}

	// Layer 1: base file.
	basePath := l.filePath(l.baseName, format)
	if exists(basePath) {
		if err := loadFile(basePath, format, out, l.overwrite); err != nil {
			return fmt.Errorf("config: load base %s: %w", basePath, err)
		}
	}

	// Layer 2: environment-specific file.
	if l.env != "" {
		envPath := l.filePath(l.baseName+"."+l.env, format)
		if exists(envPath) {
			if err := loadFile(envPath, format, out, l.overwrite); err != nil {
				return fmt.Errorf("config: load %s env %s: %w", l.env, envPath, err)
			}
		}
	}

	// Layer 3: OS env var overrides via struct tags.
	if l.envVars {
		if err := applyEnvOverrides(out); err != nil {
			return fmt.Errorf("config: apply env overrides: %w", err)
		}
	}

	return nil
}

// Load is a convenience function that creates a Loader and loads config.
//   - dir: config directory (e.g. "config/")
//   - env: environment name (e.g. "dev", "prod", "" for no env-specific file)
//   - out: pointer to the config struct
func Load(dir, env string, out any) error {
	return New().Dir(dir).Env(env).Load(out)
}

// LoadYAML loads a single YAML file into out (no env layering).
func LoadYAML(path string, out any) error {
	return loadFile(path, FormatYAML, out, false)
}

// LoadENV loads a single .env file into the process environment.
func LoadENV(path string) error {
	return loadFile(path, FormatENV, nil, true)
}

// ============================================================
// Internal helpers
// ============================================================

// detectFormat checks which file exists in the config dir.
func (l *Loader) detectFormat() Format {
	for _, f := range []Format{FormatYAML, FormatENV} {
		if exists(l.filePath(l.baseName, f)) {
			return f
		}
	}
	// Default to YAML if nothing exists yet.
	return FormatYAML
}

// filePath builds the full path for a given name and format.
func (l *Loader) filePath(name string, f Format) string {
	ext := ".yaml"
	if f == FormatENV {
		ext = ".env"
	}
	return filepath.Join(l.dir, name+ext)
}

// exists checks if a file exists.
func exists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

// loadFile dispatches to the correct parser based on format.
func loadFile(path string, format Format, out any, overwriteEnv bool) error {
	switch format {
	case FormatYAML:
		return loadYAML(path, out)
	case FormatENV:
		return loadENVFile(path, overwriteEnv)
	default:
		// Auto-detect from extension.
		ext := strings.ToLower(filepath.Ext(path))
		switch ext {
		case ".yaml", ".yml":
			return loadYAML(path, out)
		case ".env":
			return loadENVFile(path, overwriteEnv)
		default:
			return fmt.Errorf("config: unknown format for %s", path)
		}
	}
}
