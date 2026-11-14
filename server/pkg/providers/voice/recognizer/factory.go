package recognizer

import (
	"fmt"
	"sync"
)

// Vendor identifies an ASR service provider.
type Vendor string

const (
	VendorQCloud         Vendor = "qcloud"
	VendorGoogle         Vendor = "google"
	VendorAliyun         Vendor = "aliyun"
	VendorFunASR         Vendor = "funasr"
	VendorVolcengine     Vendor = "volcengine"
	VendorVolcengineLLM  Vendor = "volcllmasr"
	VendorXfyunMul       Vendor = "xfyun_mul"
	VendorGladia         Vendor = "gladia"
	VendorFunASRRealtime Vendor = "funasr_realtime"
	VendorWhisper        Vendor = "whisper"
	VendorDeepgram       Vendor = "deepgram"
	VendorAWS            Vendor = "aws"
	VendorBaidu          Vendor = "baidu"
	VendorVoiceAPI       Vendor = "voiceapi"
	VendorLocal          Vendor = "local"
)

// TranscriberConfig is the unified config interface for ASR engines.
type TranscriberConfig interface {
	GetVendor() Vendor
}

// Creator is a function that creates an Engine from a TranscriberConfig.
type Creator func(TranscriberConfig) (Engine, error)

// Factory creates ASR engines by vendor.
type Factory interface {
	CreateTranscriber(config TranscriberConfig) (Engine, error)
	GetSupportedVendors() []Vendor
	IsVendorSupported(vendor Vendor) bool
	RegisterCreator(vendor Vendor, creator Creator)
}

// DefaultFactory is the thread-safe default implementation of Factory.
type DefaultFactory struct {
	creators map[Vendor]Creator
	mu       sync.RWMutex
}

// NewFactory creates a new empty factory.
func NewFactory() *DefaultFactory {
	return &DefaultFactory{
		creators: make(map[Vendor]Creator),
	}
}

// RegisterCreator registers a creator function for a vendor.
func (f *DefaultFactory) RegisterCreator(vendor Vendor, creator Creator) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.creators[vendor] = creator
}

// CreateTranscriber looks up the creator for the config's vendor and invokes it.
func (f *DefaultFactory) CreateTranscriber(config TranscriberConfig) (Engine, error) {
	if config == nil {
		return nil, fmt.Errorf("config cannot be nil")
	}
	vendor := config.GetVendor()
	f.mu.RLock()
	creator, exists := f.creators[vendor]
	f.mu.RUnlock()
	if !exists {
		return nil, fmt.Errorf("vendor %s not supported", vendor)
	}
	return creator(config)
}

// GetSupportedVendors returns all registered vendors.
func (f *DefaultFactory) GetSupportedVendors() []Vendor {
	f.mu.RLock()
	defer f.mu.RUnlock()
	vendors := make([]Vendor, 0, len(f.creators))
	for v := range f.creators {
		vendors = append(vendors, v)
	}
	return vendors
}

// IsVendorSupported checks if a vendor is registered.
func (f *DefaultFactory) IsVendorSupported(vendor Vendor) bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	_, exists := f.creators[vendor]
	return exists
}

// Global factory singleton.
var (
	globalFactory *DefaultFactory
	factoryOnce   sync.Once
)

// GetGlobalFactory returns the global factory instance.
func GetGlobalFactory() *DefaultFactory {
	factoryOnce.Do(func() {
		globalFactory = NewFactory()
	})
	return globalFactory
}

// SetGlobalFactory sets the global factory instance.
func SetGlobalFactory(factory *DefaultFactory) {
	factoryOnce.Do(func() {
		globalFactory = factory
	})
}

// Create is a convenience function using the global factory.
func Create(config TranscriberConfig) (Engine, error) {
	return GetGlobalFactory().CreateTranscriber(config)
}

// MustCreate is like Create but panics on error.
func MustCreate(config TranscriberConfig) Engine {
	engine, err := Create(config)
	if err != nil {
		panic(err)
	}
	return engine
}

// RegisterAllVendors registers all known vendor creators into the given factory.
// Vendor submodules call RegisterCreator individually; this helper provides a
// single entry point for consumers that want to register all vendors at once.
// Each registration is guarded by a nil-creator check so partial registrations
// are safe.
func RegisterAllVendors(f *DefaultFactory, registrations map[Vendor]Creator) {
	if f == nil {
		return
	}
	for vendor, creator := range registrations {
		if creator == nil {
			continue
		}
		f.RegisterCreator(vendor, creator)
	}
}

// GetVendor returns the Vendor enum for a provider string.
func GetVendor(provider string) Vendor {
	if provider == "tencent" {
		return VendorQCloud
	}
	return Vendor(provider)
}

// VendorString returns the string representation of a Vendor.
func VendorString(v Vendor) string {
	return string(v)
}

// AllVendors returns all known vendor constants in a deterministic order.
func AllVendors() []Vendor {
	return []Vendor{
		VendorQCloud,
		VendorGoogle,
		VendorAliyun,
		VendorFunASR,
		VendorVolcengine,
		VendorVolcengineLLM,
		VendorXfyunMul,
		VendorGladia,
		VendorFunASRRealtime,
		VendorWhisper,
		VendorDeepgram,
		VendorAWS,
		VendorBaidu,
		VendorVoiceAPI,
		VendorLocal,
	}
}
