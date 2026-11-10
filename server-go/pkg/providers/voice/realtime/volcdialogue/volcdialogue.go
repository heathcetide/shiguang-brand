// Package realtime implements the Volcengine / 豆包 Realtime Dialogue API
// adapter for ling-base. See protocol.go for the binary framing.
package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/realtime"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	ProviderSlug      = "volcengine_dialogue"
	DefaultBaseURL    = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue"
	DefaultResourceID = "volc.speech.dialog"
	DefaultAppKey     = "PlgvMymc7f3tQnJ6"
	DefaultModelO     = "1.2.1.1" // O2.0
	DefaultModelSC    = "2.2.0.0" // SC2.0
	DefaultSpeaker    = "zh_female_vv_jupiter_bigtts"
	DefaultDialMs     = 15000
	DefaultSendBuf    = 32
)

func init() {
	base.Register(New, ProviderSlug, "volc_realtime", "doubao_realtime", "volcengine_realtime")
}

// Config is the tenant credential JSON for this provider.
type Config struct {
	AppID             string
	AccessKey         string
	AppKey            string
	ResourceID        string
	BaseURL           string
	Model             string // 1.2.1.1 (O) or 2.2.0.0 (SC)
	Speaker           string
	BotName           string
	SystemRole        string
	SpeakingStyle     string
	CharacterManifest string
	DialTimeoutMs     int
}

// New is the realtime.Provider entry point.
//
//	cfg keys: appId, accessKey (or access_token/token), appKey, resourceId,
//	model, speaker/voice, botName, systemRole, speakingStyle,
//	characterManifest, baseUrl, dialTimeoutMs
func New(cfg map[string]any, opts base.Options) (base.Agent, error) {
	c := Config{
		AppID:             base.FirstString(cfg, "appId", "app_id"),
		AccessKey:         base.FirstString(cfg, "accessKey", "access_key", "access_token", "token"),
		AppKey:            base.FirstString(cfg, "appKey", "app_key"),
		ResourceID:        base.FirstString(cfg, "resourceId", "resource_id"),
		BaseURL:           base.FirstString(cfg, "baseUrl", "base_url"),
		Model:             base.FirstString(cfg, "model"),
		Speaker:           base.FirstString(cfg, "speaker", "voice"),
		BotName:           base.FirstString(cfg, "botName", "bot_name"),
		SystemRole:        base.FirstString(cfg, "systemRole", "system_role", "instructions"),
		SpeakingStyle:     base.FirstString(cfg, "speakingStyle", "speaking_style"),
		CharacterManifest: base.FirstString(cfg, "characterManifest", "character_manifest"),
		DialTimeoutMs:     base.FirstInt(cfg, "dialTimeoutMs", "dial_timeout_ms"),
	}
	if c.AppID == "" || c.AccessKey == "" {
		return nil, fmt.Errorf("volcdialogue: appId and accessKey are required")
	}
	if c.AppKey == "" {
		c.AppKey = DefaultAppKey
	}
	if c.ResourceID == "" {
		c.ResourceID = DefaultResourceID
	}
	if c.BaseURL == "" {
		c.BaseURL = DefaultBaseURL
	}
	if c.Model == "" {
		c.Model = DefaultModelO
	}
	if c.Speaker == "" {
		c.Speaker = DefaultSpeaker
	}
	if strings.TrimSpace(opts.Voice) != "" {
		c.Speaker = strings.TrimSpace(opts.Voice)
	}
	if c.DialTimeoutMs <= 0 {
		c.DialTimeoutMs = DefaultDialMs
	}

	sys := strings.TrimSpace(c.SystemRole)
	if sys == "" {
		sys = strings.TrimSpace(opts.SystemPrompt)
	} else if sp := strings.TrimSpace(opts.SystemPrompt); sp != "" {
		sys = sys + "\n\n" + sp
	}
	c.SystemRole = sys

	return &Agent{
		cfg:       c,
		opts:      opts,
		sessionID: uuid.New().String(),
		sendCh:    make(chan []byte, DefaultSendBuf),
	}, nil
}

// Agent is the Volcengine Realtime Dialogue client.
type Agent struct {
	cfg       Config
	opts      base.Options
	sessionID string

	conn *websocket.Conn

	startOnce sync.Once
	closeOnce sync.Once
	closed    atomic.Bool
	openFired atomic.Bool

	sendCh chan []byte
	wg     sync.WaitGroup

	rootCtx    context.Context
	rootCancel context.CancelFunc
}

func (a *Agent) Start(ctx context.Context) error {
	var err error
	a.startOnce.Do(func() { err = a.doStart(ctx) })
	return err
}

func (a *Agent) doStart(ctx context.Context) error {
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = time.Duration(a.cfg.DialTimeoutMs) * time.Millisecond

	headers := http.Header{}
	headers.Set("X-Api-App-ID", a.cfg.AppID)
	headers.Set("X-Api-Access-Key", a.cfg.AccessKey)
	headers.Set("X-Api-Resource-Id", a.cfg.ResourceID)
	headers.Set("X-Api-App-Key", a.cfg.AppKey)
	headers.Set("X-Api-Connect-Id", uuid.New().String())

	conn, resp, err := dialer.DialContext(ctx, a.cfg.BaseURL, headers)
	if err != nil {
		status := -1
		if resp != nil {
			status = resp.StatusCode
			_ = resp.Body.Close()
		}
		return fmt.Errorf("volcdialogue: dial (status=%d): %w", status, err)
	}
	a.conn = conn

	if err := a.handshake(); err != nil {
		_ = conn.Close()
		return err
	}

	a.rootCtx, a.rootCancel = context.WithCancel(context.Background())
	a.wg.Add(2)
	go a.writeLoop()
	go a.readLoop()
	return nil
}

func (a *Agent) handshake() error {
	// StartConnection
	frame, err := MarshalJSONEvent(eventStartConnection, "", map[string]any{})
	if err != nil {
		return err
	}
	if err := a.conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		return fmt.Errorf("volcdialogue: send StartConnection: %w", err)
	}
	f, err := a.readOneHandshake()
	if err != nil {
		return fmt.Errorf("volcdialogue: StartConnection: %w", err)
	}
	if f.Event != eventConnectionStarted {
		return fmt.Errorf("volcdialogue: expected ConnectionStarted(50), got event %d: %s", f.Event, string(f.Payload))
	}

	// StartSession
	payload := a.buildStartSession()
	frame, err = MarshalJSONEvent(eventStartSession, a.sessionID, payload)
	if err != nil {
		return err
	}
	if err := a.conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		return fmt.Errorf("volcdialogue: send StartSession: %w", err)
	}
	f, err = a.readOneHandshake()
	if err != nil {
		return fmt.Errorf("volcdialogue: StartSession: %w", err)
	}
	if f.Event != eventSessionStarted {
		if f.Event == eventSessionFailed {
			return fmt.Errorf("volcdialogue: session failed: %s", string(f.Payload))
		}
		return fmt.Errorf("volcdialogue: expected SessionStarted(150), got event %d: %s", f.Event, string(f.Payload))
	}

	a.fireOnce(base.Event{Type: base.EventSessionOpen, Vendor: ProviderSlug})
	return nil
}

func (a *Agent) readOneHandshake() (*Frame, error) {
	_, data, err := a.conn.ReadMessage()
	if err != nil {
		return nil, err
	}
	return ParseFrame(data)
}

func (a *Agent) buildStartSession() StartSessionPayload {
	outRate := a.opts.OutputSampleRate
	if outRate <= 0 {
		outRate = 24000
	}
	dialogExtra := map[string]any{
		"strict_audit": false,
		"input_mod":    "audio",
		"model":        a.cfg.Model,
	}
	// SC2.0 uses character_manifest; O/O2 uses bot_name + system_role.
	if strings.TrimSpace(a.cfg.CharacterManifest) != "" {
		return StartSessionPayload{
			ASR: ASRPayload{Format: "pcm", Rate: 16000, Bits: 16, Channel: 1},
			TTS: TTSPayload{
				Speaker: a.cfg.Speaker,
				AudioConfig: AudioConfig{
					Channel: 1, Format: "pcm_s16le", SampleRate: outRate,
				},
			},
			Dialog: DialogPayload{
				CharacterManifest: a.cfg.CharacterManifest,
				Extra:             dialogExtra,
			},
		}
	}
	botName := a.cfg.BotName
	if botName == "" {
		botName = "豆包"
	}
	style := a.cfg.SpeakingStyle
	if style == "" {
		style = "专业、简洁、友好"
	}
	return StartSessionPayload{
		ASR: ASRPayload{
			Format: "pcm", Rate: 16000, Bits: 16, Channel: 1,
			Extra: map[string]any{"enable_itn_convert": true},
		},
		TTS: TTSPayload{
			Speaker: a.cfg.Speaker,
			AudioConfig: AudioConfig{
				Channel: 1, Format: "pcm_s16le", SampleRate: outRate,
			},
		},
		Dialog: DialogPayload{
			BotName:       botName,
			SystemRole:    a.cfg.SystemRole,
			SpeakingStyle: style,
			Extra:         dialogExtra,
		},
	}
}

func (a *Agent) PushAudio(pcm []byte) error {
	if a.closed.Load() {
		return base.ErrAgentClosed
	}
	if len(pcm) == 0 {
		return nil
	}
	frame, err := MarshalAudioTask(a.sessionID, pcm)
	if err != nil {
		return err
	}
	return a.enqueue(frame, true)
}

func (a *Agent) CommitInputAudio() error { return nil }

func (a *Agent) Cancel() error {
	// Server VAD handles turn boundaries; local media layer drops in-flight audio.
	return nil
}

func (a *Agent) UpdateInstructions(instructions string) error {
	instructions = strings.TrimSpace(instructions)
	if instructions == "" {
		return nil
	}
	a.cfg.SystemRole = instructions
	if a.closed.Load() || a.conn == nil {
		return base.ErrAgentClosed
	}
	payload := map[string]any{
		"dialog": map[string]any{
			"system_role": instructions,
		},
	}
	frame, err := MarshalJSONEvent(eventUpdateConfig, a.sessionID, payload)
	if err != nil {
		return err
	}
	return a.enqueue(frame, false)
}

func (a *Agent) Close() error {
	a.closeOnce.Do(func() {
		a.closed.Store(true)
		if a.rootCancel != nil {
			a.rootCancel()
		}
		if a.conn != nil {
			if frame, err := MarshalJSONEvent(eventFinishSession, a.sessionID, map[string]any{}); err == nil {
				_ = a.conn.WriteMessage(websocket.BinaryMessage, frame)
			}
			if frame, err := MarshalJSONEvent(eventFinishConnection, "", map[string]any{}); err == nil {
				_ = a.conn.WriteMessage(websocket.BinaryMessage, frame)
			}
			_ = a.conn.Close()
		}
		a.wg.Wait()
		if !a.openFired.Load() {
			return
		}
		a.emit(base.Event{Type: base.EventSessionClose, Vendor: ProviderSlug})
	})
	return nil
}

func (a *Agent) enqueue(frame []byte, nonBlocking bool) error {
	if a.closed.Load() {
		return base.ErrAgentClosed
	}
	if nonBlocking {
		select {
		case a.sendCh <- frame:
			return nil
		case <-a.rootCtx.Done():
			return base.ErrAgentClosed
		default:
			return nil
		}
	}
	select {
	case a.sendCh <- frame:
		return nil
	case <-a.rootCtx.Done():
		return base.ErrAgentClosed
	}
}

func (a *Agent) writeLoop() {
	defer a.wg.Done()
	for {
		select {
		case <-a.rootCtx.Done():
			return
		case frame, ok := <-a.sendCh:
			if !ok {
				return
			}
			if a.conn == nil {
				continue
			}
			if err := a.conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
				a.emit(base.Event{
					Type:   base.EventError,
					Err:    fmt.Errorf("volcdialogue: write: %w", err),
					Fatal:  true,
					Vendor: ProviderSlug,
				})
				return
			}
		}
	}
}

func (a *Agent) readLoop() {
	defer a.wg.Done()
	defer func() {
		if a.rootCancel != nil {
			a.rootCancel()
		}
	}()
	for {
		if a.closed.Load() {
			return
		}
		_, data, err := a.conn.ReadMessage()
		if err != nil {
			if !a.closed.Load() {
				a.emit(base.Event{
					Type:   base.EventError,
					Err:    fmt.Errorf("volcdialogue: read: %w", err),
					Fatal:  true,
					Vendor: ProviderSlug,
				})
			}
			return
		}
		f, err := ParseFrame(data)
		if err != nil {
			a.emit(base.Event{
				Type:   base.EventError,
				Err:    err,
				Fatal:  false,
				Vendor: ProviderSlug,
			})
			continue
		}
		a.dispatch(f)
	}
}

func (a *Agent) dispatch(f *Frame) {
	if f.MsgType == msgTypeError {
		a.emit(base.Event{
			Type:   base.EventError,
			Err:    fmt.Errorf("volcdialogue: server error %d: %s", f.ErrorCode, string(f.Payload)),
			Fatal:  true,
			Vendor: ProviderSlug,
		})
		return
	}

	if f.IsAudioServer() {
		a.emit(base.Event{
			Type:    base.EventAssistantAudio,
			AudioPC: append([]byte(nil), f.Payload...),
			Vendor:  ProviderSlug,
		})
		return
	}

	if f.MsgType != msgTypeFullServer {
		return
	}

	switch f.Event {
	case eventASRStarted:
		a.emit(base.Event{Type: base.EventUserSpeechStarted, Vendor: ProviderSlug})

	case eventASRResponse:
		var p asrResponsePayload
		if json.Unmarshal(f.Payload, &p) == nil && len(p.Results) > 0 {
			r := p.Results[0]
			if strings.TrimSpace(r.Text) != "" {
				a.emit(base.Event{
					Type:   base.EventUserTranscript,
					Text:   r.Text,
					Final:  !r.IsInterim,
					Vendor: ProviderSlug,
				})
			}
		}

	case eventASREnded:
		a.emit(base.Event{Type: base.EventUserSpeechEnded, Vendor: ProviderSlug})

	case eventChatResponse:
		var p chatResponsePayload
		if json.Unmarshal(f.Payload, &p) == nil && p.Content != "" {
			a.emit(base.Event{
				Type:   base.EventAssistantText,
				Text:   p.Content,
				Final:  false,
				Vendor: ProviderSlug,
			})
		}

	case eventChatEnded:
		a.emit(base.Event{
			Type:   base.EventAssistantText,
			Text:   "",
			Final:  true,
			Vendor: ProviderSlug,
		})

	case eventTTSEnded:
		a.emit(base.Event{Type: base.EventAssistantTurnEnd, Vendor: ProviderSlug})

	case eventSessionFailed, eventDialogCommonError:
		var de dialogErrorPayload
		msg := string(f.Payload)
		if json.Unmarshal(f.Payload, &de) == nil && de.Message != "" {
			msg = de.Message
		}
		a.emit(base.Event{
			Type:   base.EventError,
			Err:    fmt.Errorf("volcdialogue: event %d: %s", f.Event, msg),
			Fatal:  true,
			Vendor: ProviderSlug,
		})

	case eventConnectionStarted, eventSessionStarted:
		// Handled during handshake.
	}
}

func (a *Agent) fireOnce(ev base.Event) {
	if a.openFired.CompareAndSwap(false, true) {
		ev.Vendor = ProviderSlug
		a.opts.OnEvent(ev)
	}
}

func (a *Agent) emit(ev base.Event) {
	if a.opts.OnEvent == nil {
		return
	}
	if a.closed.Load() && ev.Type != base.EventSessionClose {
		return
	}
	if ev.Vendor == "" {
		ev.Vendor = ProviderSlug
	}
	a.opts.OnEvent(ev)
}

// Compile-time guard.
var _ base.Agent = (*Agent)(nil)
