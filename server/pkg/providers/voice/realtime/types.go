// Package realtime defines the core types and interfaces for full-duplex
// multimodal realtime voice agents.
//
// This is the provider-agnostic core package. Vendor-specific implementations
// live in submodules (e.g. realtime/openai, realtime/gemini, realtime/aliyunomni,
// realtime/volcdialogue).
//
// The realtime layer collapses ASR+LLM+TTS into a single end-to-end stream
// (Qwen-Omni realtime, GPT-4o realtime, Gemini Live, …). It is a peer
// abstraction to:
//
//	recognizer   — ASR only
//	synthesizer  — TTS only
//
// Lifecycle:
//
//	agent, _ := realtime.NewAgentFromCredential(cfg, opts)
//	_ = agent.Start(ctx)              // opens WS, sends session.update
//	for { agent.PushAudio(pcm16le) }  // caller PCM 16k mono
//	agent.Cancel()                    // optional barge-in: stop current AI reply
//	agent.Close()                     // teardown
//
// All callbacks fire from the WS read goroutine. Implementations MUST NOT
// block in callbacks; callers should push events into channels handled by
// dedicated workers.
package realtime

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
)

// EventType enumerates the high-level events surfaced to callers. Provider
// implementations are responsible for translating their wire protocol into
// this enum so integration code is provider-agnostic.
type EventType string

const (
	// EventSessionOpen fires once after a successful WS handshake +
	// session.update ack. Used to mark "ready to forward audio".
	EventSessionOpen EventType = "session.open"
	// EventSessionClose fires once when the WS closes for any reason.
	EventSessionClose EventType = "session.close"

	// EventUserTranscript carries the caller's ASR transcript. `Final=true`
	// means the model finished hearing this utterance.
	EventUserTranscript EventType = "user.transcript"
	// EventUserSpeechStarted fires when the server-side VAD detects the
	// caller began speaking. Callers must immediately stop forwarding any
	// in-flight AI PCM (barge-in).
	EventUserSpeechStarted EventType = "user.speech.started"
	// EventUserSpeechEnded fires when the server-side VAD detects the
	// caller stopped speaking.
	EventUserSpeechEnded EventType = "user.speech.ended"

	// EventAssistantText carries an AI text fragment. `Final=true` ends
	// the current assistant response.
	EventAssistantText EventType = "assistant.text"
	// EventAssistantAudio carries a chunk of AI audio at OutputSampleRate.
	EventAssistantAudio EventType = "assistant.audio"
	// EventAssistantTurnEnd fires when the model finishes one full reply.
	EventAssistantTurnEnd EventType = "assistant.turn.end"

	// EventError surfaces a server-reported error. `Fatal=true` means the
	// session is unrecoverable.
	EventError EventType = "error"
)

// Event is the union type passed to Options.OnEvent. Only the fields
// relevant to the EventType are populated; the rest are zero-value.
type Event struct {
	Type    EventType
	Text    string
	Final   bool
	AudioPC []byte // PCM16LE mono @ Options.OutputSampleRate
	Err     error
	Fatal   bool
	// Vendor is the provider slug ("aliyun_omni", …) for logging.
	Vendor string
	// Raw carries the unparsed event JSON for diagnostic logs (optional;
	// implementations may leave nil to avoid the allocation).
	Raw []byte
}

// Options configure a single realtime session. The caller-facing PCM
// contract is fixed at PCM16LE mono; rates may differ per provider but
// 16 kHz in / 24 kHz out is the de-facto standard (Qwen-Omni, GPT-4o).
type Options struct {
	// SystemPrompt is sent as the model's `instructions`.
	SystemPrompt string
	// Voice selects the AI voice. Provider-specific values.
	Voice string
	// InputSampleRate is the sample rate of PCM frames passed to PushAudio.
	// Defaults to 16000 if 0.
	InputSampleRate int
	// OutputSampleRate is the rate the provider will emit audio at.
	// Defaults to 24000 if 0.
	OutputSampleRate int
	// OnEvent receives all session events. Required.
	OnEvent func(Event)
	// DisableServerVAD opts out of server-side voice activity detection.
	// Defaults to false (server VAD enabled).
	DisableServerVAD bool
	// Modalities selects which output streams the model emits. Empty =
	// vendor default (audio + text).
	Modalities []string
	// Temperature controls sampling randomness. 0 means "use vendor default".
	Temperature float64
	// Tools are sent in session.update for function calling.
	Tools []Tool
	// ToolHandler runs when the model requests a tool.
	// Return value is sent back as function_call_output. Nil skips tool execution.
	ToolHandler ToolHandler
}

// Agent is the provider-agnostic full-duplex realtime client. Implementations
// are NOT required to be safe for concurrent calls into PushAudio from
// multiple goroutines — callers use a single audio-feed goroutine.
// Cancel / Close are safe to call from any goroutine at any time.
type Agent interface {
	// Start opens the underlying transport (WebSocket for current vendors)
	// and configures the session. Returns once the session is ready to
	// receive audio (or with an error before EventSessionOpen fires).
	Start(ctx context.Context) error
	// PushAudio appends one PCM16LE chunk at Options.InputSampleRate.
	PushAudio(pcm []byte) error
	// CommitInputAudio signals end-of-utterance manually. No-op when
	// server VAD is enabled (the default).
	CommitInputAudio() error
	// Cancel asks the model to stop the current reply (barge-in).
	Cancel() error
	// Close tears the session down. Idempotent.
	Close() error
	// UpdateInstructions patches session instructions mid-call.
	UpdateInstructions(instructions string) error
}

// Provider is a credential-driven factory. cfg is the parsed JSON the
// tenant control plane stored (must include "provider").
type Provider func(cfg map[string]any, opts Options) (Agent, error)

// --- Registry ---------------------------------------------------------------

var (
	registryMu sync.RWMutex
	registry   = map[string]Provider{}
)

// Register installs a Provider under one or more provider slugs. Slugs are
// normalised to lowercase. Re-registering a slug overwrites — useful for
// tests; production code should call Register exactly once per provider in
// init() of its sub-package.
func Register(provider Provider, slugs ...string) {
	registryMu.Lock()
	defer registryMu.Unlock()
	for _, s := range slugs {
		s = strings.ToLower(strings.TrimSpace(s))
		if s == "" {
			continue
		}
		registry[s] = provider
	}
}

// Lookup returns the Provider registered under slug, or nil.
func Lookup(slug string) Provider {
	registryMu.RLock()
	defer registryMu.RUnlock()
	return registry[strings.ToLower(strings.TrimSpace(slug))]
}

// RegisteredProviders returns the sorted list of registered slugs (handy
// for introspection APIs).
func RegisteredProviders() []string {
	registryMu.RLock()
	defer registryMu.RUnlock()
	out := make([]string, 0, len(registry))
	for k := range registry {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// IsProviderRegistered returns true if the slug is registered.
func IsProviderRegistered(slug string) bool {
	return Lookup(slug) != nil
}

// Unregister removes a provider slug from the registry. Mainly useful for tests.
func Unregister(slug string) {
	registryMu.Lock()
	defer registryMu.Unlock()
	delete(registry, strings.ToLower(strings.TrimSpace(slug)))
}

// --- Errors -----------------------------------------------------------------

// ErrAgentClosed is returned by PushAudio / Cancel after Close has run.
var ErrAgentClosed = errors.New("realtime: agent already closed")

// ErrNotImplemented is returned by stub providers before Connect/Start is built.
var ErrNotImplemented = errors.New("realtime: provider not implemented")

// ErrUnknownProvider is returned by NewAgentFromCredential when the
// "provider" field doesn't match any Register'ed slug.
type ErrUnknownProvider struct {
	Provider string
}

func (e *ErrUnknownProvider) Error() string {
	return fmt.Sprintf("realtime: unknown provider %q (registered: %v)",
		e.Provider, RegisteredProviders())
}
