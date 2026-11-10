package recognizer

import (
	"strings"
	"sync"
	"time"
)

// BaseEngine provides common functionality that ASR vendor implementations
// can embed to reduce boilerplate. It handles callback storage, dialog ID
// management, timing, sentence accumulation, and thread-safe state access.
//
// Vendor implementations should embed *BaseEngine and override only the
// vendor-specific methods (ConnAndReceive, SendAudioBytes, etc.).
type BaseEngine struct {
	mu sync.Mutex

	dialogID    string
	sentence    string
	startTime   *time.Time
	endTime     *time.Time
	sendReqTime *time.Time
	endReqTime  *time.Time

	tr ResultFunc
	er ErrorFunc

	vendorName string
}

// NewBaseEngine creates a BaseEngine with the given vendor name.
func NewBaseEngine(vendorName string) *BaseEngine {
	return &BaseEngine{
		vendorName: vendorName,
	}
}

// Init stores the result and error callbacks.
func (b *BaseEngine) Init(tr ResultFunc, er ErrorFunc) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.tr = tr
	b.er = er
}

// Vendor returns the vendor name.
func (b *BaseEngine) Vendor() string {
	return b.vendorName
}

// SetDialogID sets the current dialog identifier.
func (b *BaseEngine) SetDialogID(id string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.dialogID = id
}

// DialogID returns the current dialog identifier.
func (b *BaseEngine) DialogID() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.dialogID
}

// ResetState resets the engine state for a new recognition session.
// This includes clearing the accumulated sentence, resetting timing,
// and setting the send request time to now.
func (b *BaseEngine) ResetState() {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	b.sendReqTime = &now
	b.endReqTime = nil
	b.sentence = ""
}

// MarkEnd records the end-of-request timestamp.
func (b *BaseEngine) MarkEnd() {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	b.endReqTime = &now
}

// SinceSend returns the duration since the request was started.
// Returns 0 if ResetState has not been called.
func (b *BaseEngine) SinceSend() time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.sendReqTime == nil {
		return 0
	}
	return time.Since(*b.sendReqTime)
}

// EmitPartial emits a partial recognition result via the callback.
func (b *BaseEngine) EmitPartial(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	b.mu.Lock()
	b.sentence = text
	tr := b.tr
	dialogID := b.dialogID
	dur := time.Duration(0)
	if b.sendReqTime != nil {
		dur = time.Since(*b.sendReqTime)
	}
	b.mu.Unlock()

	if tr != nil {
		tr(text, false, dur, dialogID)
	}
}

// EmitFinal emits a final recognition result via the callback.
// If text is empty, the last partial sentence is used.
func (b *BaseEngine) EmitFinal(text string) {
	text = strings.TrimSpace(text)
	b.mu.Lock()
	if text == "" {
		text = strings.TrimSpace(b.sentence)
	}
	if text == "" {
		b.mu.Unlock()
		return
	}
	b.sentence = text
	tr := b.tr
	dialogID := b.dialogID
	dur := time.Duration(0)
	if b.sendReqTime != nil {
		dur = time.Since(*b.sendReqTime)
	}
	b.sentence = ""
	b.mu.Unlock()

	if tr != nil {
		tr(text, true, dur, dialogID)
	}
}

// EmitError emits an error via the error callback.
func (b *BaseEngine) EmitError(err error, isFatal bool) {
	b.mu.Lock()
	er := b.er
	b.mu.Unlock()

	if er != nil {
		er(err, isFatal)
	}
}

// Sentence returns the current accumulated sentence text.
func (b *BaseEngine) Sentence() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.sentence
}

// HasSentence returns true if there is a non-empty accumulated sentence.
func (b *BaseEngine) HasSentence() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return strings.TrimSpace(b.sentence) != ""
}

// Callbacks returns the stored result and error callbacks.
// This is useful for vendor implementations that need to call them directly.
func (b *BaseEngine) Callbacks() (ResultFunc, ErrorFunc) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.tr, b.er
}
