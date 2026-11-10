package recognizer

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Recognizer is a high-level ASR recognizer that wraps the Client with
// audio buffering, callbacks, and result conversion.
type Recognizer struct {
	client *Client
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex

	// Audio buffer and configuration
	pendingAudio     []byte
	targetBufferSize int
	audioConfig      AudioConfig
	timeoutConfig    TimeoutConfig

	// Callback functions
	onResult onResultFunc
	onError  onErrorFunc

	// State management
	isEndFrameSent bool
}

type onResultFunc func(*Result)
type onErrorFunc func(error)

// NewRecognizer creates a new Recognizer from a Config.
func NewRecognizer(config *Config) *Recognizer {
	bufferDurationMs := config.Buffer.SegmentDurationMs
	if bufferDurationMs == 0 {
		bufferDurationMs = 100
	}

	bufferSize := config.Audio.Rate * config.Audio.Bits / 8 * config.Audio.Channel * bufferDurationMs / 1000

	return &Recognizer{
		client:           NewClient(config),
		pendingAudio:     make([]byte, 0, bufferSize),
		targetBufferSize: bufferSize,
		audioConfig: AudioConfig{
			Rate:    config.Audio.Rate,
			Bits:    config.Audio.Bits,
			Channel: config.Audio.Channel,
		},
		timeoutConfig: DefaultTimeoutConfig(),
	}
}

// OnResult registers the callback for recognition results.
func (r *Recognizer) OnResult(callback onResultFunc) {
	r.onResult = callback
}

// OnError registers the callback for error handling.
func (r *Recognizer) OnError(callback onErrorFunc) {
	r.onError = callback
}

// Start connects to the ASR server and begins receiving results.
func (r *Recognizer) Start() error {
	r.ctx, r.cancel = context.WithCancel(context.Background())

	r.client.SetErrorCallback(func(err error) {
		if r.onError != nil {
			r.onError(err)
		}
	})

	r.client.SetTimeouts(r.timeoutConfig.Send, r.timeoutConfig.Read)
	if err := r.client.Connect(r.ctx); err != nil {
		return err
	}

	go r.receiveResults()

	return nil
}

// SendAudioFrame sends an audio frame to the recognizer. If end is true,
// all buffered data is flushed and an end marker is sent.
func (r *Recognizer) SendAudioFrame(frame *AudioFrame) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.isEndFrameSent {
		return nil
	}

	if frame.IsEnd {
		if len(r.pendingAudio) > 0 {
			if err := r.flushPendingAudioLocked(); err != nil {
				return err
			}
		}
		r.isEndFrameSent = true
		return r.client.SendAudioFrame(&AudioFrame{IsEnd: true})
	}

	if len(frame.Data) > 0 {
		r.pendingAudio = append(r.pendingAudio, frame.Data...)
	}
	if len(r.pendingAudio) >= r.targetBufferSize {
		return r.flushPendingAudioLocked()
	}

	return nil
}

// flushPendingAudioLocked sends the current buffer content.
func (r *Recognizer) flushPendingAudioLocked() error {
	if len(r.pendingAudio) == 0 {
		return nil
	}

	toSend := make([]byte, len(r.pendingAudio))
	copy(toSend, r.pendingAudio)
	r.pendingAudio = r.pendingAudio[:0]

	return r.client.SendAudioFrame(&AudioFrame{Data: toSend})
}

// Stop closes the recognizer and releases resources.
func (r *Recognizer) Stop() {
	if r.cancel != nil {
		r.cancel()
	}
	r.client.Close()
}

// receiveResults handles response reading and conversion.
func (r *Recognizer) receiveResults() {
	for {
		select {
		case <-r.ctx.Done():
			return
		default:
			resp, err := r.client.ReceiveResult()
			if errors.Is(err, ErrClientClosed) {
				return
			}

			result := r.convertResponseToResult(resp)

			if result.Error != nil && r.onError != nil {
				r.onError(result.Error)
			}

			if r.onResult != nil {
				r.onResult(result)
			}
		}
	}
}

// convertResponseToResult converts ASR response to Result.
func (r *Recognizer) convertResponseToResult(resp *Response) *Result {
	result := &Result{
		IsFinal:   resp.IsLastPackage,
		Timestamp: time.Now(),
	}

	if resp.Code != 0 {
		result.Error = fmt.Errorf("asr error code: %d, msg: %v", resp.Code, resp.PayloadMsg)
	}

	if resp.PayloadMsg != nil && resp.PayloadMsg.Result.Text != "" {
		result.Text = resp.PayloadMsg.Result.Text
	}

	if resp.Err != nil {
		result.Error = resp.Err
	}

	return result
}

// GetTraceID returns the trace ID from the underlying client.
func (r *Recognizer) GetTraceID() string {
	if r != nil && r.client != nil {
		return r.client.GetTraceID()
	}
	return ""
}
