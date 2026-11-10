package synthesizer

import (
	"fmt"
	"sync"
)

// Config is the unified TTS configuration interface.
type Config interface {
	GetProvider() Provider
}

// Creator is a function that creates an Engine from a Config.
type Creator func(Config) (Engine, error)

// Factory creates TTS engines by provider.
type Factory interface {
	CreateEngine(config Config) (Engine, error)
	GetSupportedProviders() []Provider
	IsProviderSupported(provider Provider) bool
	RegisterCreator(provider Provider, creator Creator)
}

// DefaultFactory is the thread-safe default implementation of Factory.
type DefaultFactory struct {
	creators map[Provider]Creator
	mu       sync.RWMutex
}

// NewFactory creates a new empty factory.
func NewFactory() *DefaultFactory {
	return &DefaultFactory{
		creators: make(map[Provider]Creator),
	}
}

// RegisterCreator registers a creator function for a provider.
func (f *DefaultFactory) RegisterCreator(provider Provider, creator Creator) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.creators[provider] = creator
}

// CreateEngine looks up the creator for the config's provider and invokes it.
func (f *DefaultFactory) CreateEngine(config Config) (Engine, error) {
	if config == nil {
		return nil, fmt.Errorf("config cannot be nil")
	}
	provider := config.GetProvider()
	f.mu.RLock()
	creator, exists := f.creators[provider]
	f.mu.RUnlock()
	if !exists {
		return nil, fmt.Errorf("provider %s not supported", provider)
	}
	return creator(config)
}

// GetSupportedProviders returns all registered providers.
func (f *DefaultFactory) GetSupportedProviders() []Provider {
	f.mu.RLock()
	defer f.mu.RUnlock()
	providers := make([]Provider, 0, len(f.creators))
	for p := range f.creators {
		providers = append(providers, p)
	}
	return providers
}

// IsProviderSupported checks if a provider is registered.
func (f *DefaultFactory) IsProviderSupported(provider Provider) bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	_, exists := f.creators[provider]
	return exists
}

// Global factory singleton.
var (
	globalFactory *DefaultFactory
	factoryMutex  sync.Mutex
)

// GetGlobalFactory returns the global factory instance.
func GetGlobalFactory() *DefaultFactory {
	factoryMutex.Lock()
	defer factoryMutex.Unlock()
	if globalFactory == nil {
		globalFactory = NewFactory()
	}
	return globalFactory
}

// SetGlobalFactory sets the global factory instance.
func SetGlobalFactory(factory *DefaultFactory) {
	factoryMutex.Lock()
	defer factoryMutex.Unlock()
	globalFactory = factory
}

// Create is a convenience function using the global factory.
func Create(config Config) (Engine, error) {
	return GetGlobalFactory().CreateEngine(config)
}

// MustCreate is like Create but panics on error.
func MustCreate(config Config) Engine {
	engine, err := Create(config)
	if err != nil {
		panic(err)
	}
	return engine
}

// AllProviders returns all known provider constants in a deterministic order.
func AllProviders() []Provider {
	return []Provider{
		ProviderQiniu,
		ProviderXunfei,
		ProviderAliyun,
		ProviderTencent,
		ProviderBaidu,
		ProviderAzure,
		ProviderGoogle,
		ProviderAWS,
		ProviderOpenAI,
		ProviderElevenLabs,
		ProviderLocal,
		ProviderLocalGoSpeech,
		ProviderFishSpeech,
		ProviderFishAudio,
		ProviderCoqui,
		ProviderVolcengine,
		ProviderVolcengineClone,
		ProviderVolcengineLLM,
		ProviderMinimax,
	}
}

// RegisterAllProviders registers all known provider creators into the given factory.
// Provider submodules call RegisterCreator individually; this helper provides a
// single entry point for consumers that want to register all providers at once.
func RegisterAllProviders(f *DefaultFactory, registrations map[Provider]Creator) {
	if f == nil {
		return
	}
	for provider, creator := range registrations {
		if creator == nil {
			continue
		}
		f.RegisterCreator(provider, creator)
	}
}
