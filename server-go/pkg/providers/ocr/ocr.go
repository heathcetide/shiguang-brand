// Package ocr provides a vendor-agnostic OCR (Optical Character Recognition)
// abstraction for ling-base. Cloud OCR providers (Aliyun, AWS, Azure, Baidu,
// Google, QCloud) implement the Provider interface and self-register via
// RegisterProvider.
//
// The core package has zero external dependencies. Optional integrations
// live in sub-modules (e.g. ocr/aliyun, ocr/aws).
package ocr

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

// Provider is the interface that cloud OCR backends implement.
// Each provider calls a real cloud API to extract text from image bytes.
type Provider interface {
	// Name returns the provider identifier (e.g. "aliyun", "qcloud", "google").
	Name() string
	// Recognize sends image bytes to the cloud OCR API and returns extracted text.
	Recognize(ctx context.Context, imageBytes []byte, opts *Options) (string, error)
}

// Options controls provider-specific behavior (language hints, etc.).
type Options struct {
	// Language is a BCP-47 or provider-specific language hint (e.g. "zh", "en", "auto").
	Language string
	// Extra allows passing provider-specific parameters not covered by the struct.
	Extra map[string]any
}

var (
	mu       sync.RWMutex
	active   Provider
	registry = make(map[string]Provider)
)

// RegisterProvider registers an OCR provider under the given driver name.
// The last registration wins. Passing nil is a no-op.
func RegisterProvider(driver string, p Provider) {
	if p == nil {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	registry[strings.ToLower(strings.TrimSpace(driver))] = p
}

// SetProvider sets the active global OCR provider.
// Passing nil clears the active provider.
func SetProvider(p Provider) {
	mu.Lock()
	defer mu.Unlock()
	active = p
}

// SetProviderByDriver selects an already-registered provider by driver name
// as the active OCR provider. Returns an error if no provider is registered
// under that name.
func SetProviderByDriver(driver string) error {
	mu.RLock()
	p, ok := registry[strings.ToLower(strings.TrimSpace(driver))]
	mu.RUnlock()
	if !ok {
		return fmt.Errorf("ocr provider %q not registered", driver)
	}
	SetProvider(p)
	return nil
}

// GetProvider returns the currently active OCR provider, or nil if none is set.
func GetProvider() Provider {
	mu.RLock()
	defer mu.RUnlock()
	return active
}

// RegisteredDrivers returns the names of all registered OCR providers.
func RegisteredDrivers() []string {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]string, 0, len(registry))
	for k := range registry {
		out = append(out, k)
	}
	return out
}

// ErrNoProvider is returned when no OCR provider is configured.
var ErrNoProvider = fmt.Errorf("no OCR provider registered")
