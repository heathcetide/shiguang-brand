package synthesizer

// Capabilities describes vendor-specific synthesis behavior for pipeline tuning.
type Capabilities struct {
	// StreamingTTFB is true when the first audio chunk can arrive before synthesis completes.
	StreamingTTFB bool
	// SuggestedFirstMaxRunes is a segmenter hint for the first LLM→TTS chunk.
	SuggestedFirstMaxRunes int
}

// DefaultCapabilities returns conservative defaults for batch-oriented vendors.
func DefaultCapabilities() Capabilities {
	return Capabilities{
		StreamingTTFB:          false,
		SuggestedFirstMaxRunes: 12,
	}
}

// StreamingCapabilities returns capabilities for streaming vendors.
func StreamingCapabilities() Capabilities {
	return Capabilities{
		StreamingTTFB:          true,
		SuggestedFirstMaxRunes: 24,
	}
}

// CapableEngine optionally exposes vendor capabilities.
type CapableEngine interface {
	Engine
	Capabilities() Capabilities
}
