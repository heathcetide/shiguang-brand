// Package realtime implements the Volcengine / 豆包 Realtime Dialogue API
// adapter for ling-base.
//
//	wss://openspeech.bytedance.com/api/v3/realtime/dialogue
//
// Wire protocol is a custom binary framing (not JSON-over-WS). Auth: X-Api-*
// headers. Handshake: StartConnection -> ConnectionStarted -> StartSession
// -> SessionStarted. Audio frames are gzip-compressed PCM.
package realtime

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

// Client / server event IDs (Realtime Dialogue).
const (
	eventStartConnection  = 1
	eventFinishConnection = 2

	eventStartSession  = 100
	eventFinishSession = 102

	eventTaskRequest  = 200
	eventUpdateConfig = 201

	eventConnectionStarted = 50
	eventSessionStarted    = 150
	eventSessionFailed     = 153

	eventASRStarted  = 450
	eventASRResponse = 451
	eventASREnded    = 459

	eventTTSEnded = 359

	eventChatResponse = 550
	eventChatEnded    = 559

	eventDialogCommonError = 599
)

const (
	msgTypeFullClient      byte = 0x1
	msgTypeAudioOnlyClient byte = 0x2
	msgTypeFullServer      byte = 0x9
	msgTypeAudioOnlyServer byte = 0xb
	msgTypeError           byte = 0xf

	flagWithEvent     byte = 0x4
	flagPositiveSeq   byte = 0x1
	flagNegativeSeq   byte = 0x2
	serializationJSON byte = 0x1
	serializationRaw  byte = 0x0
	compressionNone   byte = 0x0
	compressionGzip   byte = 0x1
)

// Frame is a parsed server or client binary message.
type Frame struct {
	MsgType       byte
	Flags         byte
	Serialization byte
	Compression   byte
	Event         int32
	SessionID     string
	Payload       []byte
	ErrorCode     uint32
}

// IsAudioServer returns true when the frame carries assistant audio.
func (f *Frame) IsAudioServer() bool {
	return f.MsgType == msgTypeAudioOnlyServer && len(f.Payload) > 0
}

// GzipCompress compresses input bytes.
func GzipCompress(in []byte) []byte {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	_, _ = w.Write(in)
	_ = w.Close()
	return b.Bytes()
}

// GzipDecompress decompresses input bytes.
func GzipDecompress(in []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(in))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

func buildHeader(msgType, flags, serialization, compression byte) []byte {
	return []byte{
		0x11, // version 1, header size 4 bytes
		(msgType << 4) | (flags & 0x0f),
		(serialization << 4) | (compression & 0x0f),
		0x00,
	}
}

// MarshalJSONEvent builds a binary frame carrying a JSON event.
func MarshalJSONEvent(event int32, sessionID string, payload any) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return MarshalFrame(msgTypeFullClient, flagWithEvent, serializationJSON, compressionNone, event, sessionID, body)
}

// MarshalFrame builds a binary frame with the given fields.
func MarshalFrame(msgType, flags, serialization, compression byte, event int32, sessionID string, payload []byte) ([]byte, error) {
	var buf bytes.Buffer
	buf.Write(buildHeader(msgType, flags, serialization, compression))
	if flags&flagWithEvent != 0 {
		if err := binary.Write(&buf, binary.BigEndian, event); err != nil {
			return nil, err
		}
		if shouldWriteSessionID(event) {
			sid := []byte(sessionID)
			if err := binary.Write(&buf, binary.BigEndian, uint32(len(sid))); err != nil {
				return nil, err
			}
			buf.Write(sid)
		}
	}
	if err := binary.Write(&buf, binary.BigEndian, uint32(len(payload))); err != nil {
		return nil, err
	}
	buf.Write(payload)
	return buf.Bytes(), nil
}

func shouldWriteSessionID(event int32) bool {
	switch event {
	case eventStartConnection, eventFinishConnection,
		eventConnectionStarted, 51, 52:
		return false
	default:
		return true
	}
}

// MarshalAudioTask builds a binary frame carrying gzip-compressed PCM audio.
func MarshalAudioTask(sessionID string, pcm []byte) ([]byte, error) {
	compressed := GzipCompress(pcm)
	var buf bytes.Buffer
	buf.Write(buildHeader(msgTypeAudioOnlyClient, flagWithEvent, serializationRaw, compressionGzip))
	if err := binary.Write(&buf, binary.BigEndian, int32(eventTaskRequest)); err != nil {
		return nil, err
	}
	sid := []byte(sessionID)
	if err := binary.Write(&buf, binary.BigEndian, uint32(len(sid))); err != nil {
		return nil, err
	}
	buf.Write(sid)
	if err := binary.Write(&buf, binary.BigEndian, uint32(len(compressed))); err != nil {
		return nil, err
	}
	buf.Write(compressed)
	return buf.Bytes(), nil
}

// ParseFrame parses a binary server frame.
func ParseFrame(data []byte) (*Frame, error) {
	if len(data) < 4 {
		return nil, fmt.Errorf("volcdialogue: frame too short")
	}
	headerSize := int(data[0]&0x0f) * 4
	if len(data) < headerSize {
		return nil, fmt.Errorf("volcdialogue: incomplete header")
	}
	f := &Frame{
		MsgType:       data[1] >> 4,
		Flags:         data[1] & 0x0f,
		Serialization: data[2] >> 4,
		Compression:   data[2] & 0x0f,
	}
	off := headerSize

	if f.Flags&flagPositiveSeq != 0 || f.Flags&flagNegativeSeq != 0 {
		if len(data) < off+4 {
			return nil, fmt.Errorf("volcdialogue: missing sequence")
		}
		off += 4
	}

	if f.MsgType == msgTypeError {
		if len(data) < off+8 {
			return nil, fmt.Errorf("volcdialogue: incomplete error frame")
		}
		f.ErrorCode = binary.BigEndian.Uint32(data[off : off+4])
		off += 4
		size := int(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		if len(data) < off+size {
			return nil, fmt.Errorf("volcdialogue: incomplete error payload")
		}
		f.Payload = append([]byte(nil), data[off:off+size]...)
		return f, nil
	}

	if f.Flags&flagWithEvent != 0 {
		if len(data) < off+4 {
			return nil, fmt.Errorf("volcdialogue: missing event id")
		}
		f.Event = int32(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		if shouldWriteSessionID(f.Event) || f.MsgType == msgTypeAudioOnlyServer {
			if len(data) < off+4 {
				return nil, fmt.Errorf("volcdialogue: missing session id size")
			}
			sz := int(binary.BigEndian.Uint32(data[off : off+4]))
			off += 4
			if len(data) < off+sz {
				return nil, fmt.Errorf("volcdialogue: incomplete session id")
			}
			f.SessionID = string(data[off : off+sz])
			off += sz
		}
	}

	if len(data) < off+4 {
		return nil, fmt.Errorf("volcdialogue: missing payload size")
	}
	size := int(binary.BigEndian.Uint32(data[off : off+4]))
	off += 4
	if len(data) < off+size {
		return nil, fmt.Errorf("volcdialogue: incomplete payload")
	}
	raw := data[off : off+size]
	if f.Compression == compressionGzip && len(raw) > 0 {
		dec, err := GzipDecompress(raw)
		if err != nil {
			return nil, fmt.Errorf("volcdialogue: gzip decompress: %w", err)
		}
		raw = dec
	}
	f.Payload = raw
	return f, nil
}

// StartSessionPayload is the JSON payload for the StartSession event.
type StartSessionPayload struct {
	ASR    ASRPayload    `json:"asr"`
	TTS    TTSPayload    `json:"tts"`
	Dialog DialogPayload `json:"dialog"`
}

// ASRPayload configures the ASR input stream.
type ASRPayload struct {
	Format  string         `json:"format"`
	Rate    int            `json:"rate"`
	Bits    int            `json:"bits"`
	Channel int            `json:"channel"`
	Extra   map[string]any `json:"extra,omitempty"`
}

// TTSPayload configures the TTS output stream.
type TTSPayload struct {
	Speaker     string         `json:"speaker"`
	AudioConfig AudioConfig    `json:"audio_config"`
	Extra       map[string]any `json:"extra,omitempty"`
}

// AudioConfig describes the output audio format.
type AudioConfig struct {
	Channel    int    `json:"channel"`
	Format     string `json:"format"`
	SampleRate int    `json:"sample_rate"`
}

// DialogPayload configures the dialogue model and persona.
type DialogPayload struct {
	BotName           string         `json:"bot_name,omitempty"`
	SystemRole        string         `json:"system_role,omitempty"`
	SpeakingStyle     string         `json:"speaking_style,omitempty"`
	CharacterManifest string         `json:"character_manifest,omitempty"`
	Extra             map[string]any `json:"extra"`
}

type asrResponsePayload struct {
	Results []struct {
		Text      string `json:"text"`
		IsInterim bool   `json:"is_interim"`
	} `json:"results"`
}

type chatResponsePayload struct {
	Content string `json:"content"`
}

type dialogErrorPayload struct {
	StatusCode string `json:"status_code"`
	Message    string `json:"message"`
}
