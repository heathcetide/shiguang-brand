// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
)

func persistRealtimeSession(db *dbx.DB, sessionID string, userID int, body map[string]any, expiresIn int) {
	if db == nil || !db.HasTable("realtime_voice_sessions") {
		return
	}
	ctx, _ := json.Marshal(body)
	now := time.Now().UTC()
	expires := now.Add(time.Duration(expiresIn) * time.Second).Format(time.RFC3339Nano)
	_, _ = db.Exec(`INSERT INTO realtime_voice_sessions
		(id, user_id, recipe_id, status, client_platform, context_json, idempotency_key, version, connected_at, expires_at, created_at, updated_at)
		VALUES (?, ?, ?, 'active', ?, ?, ?, 1, ?, ?, ?, ?)
		ON CONFLICT(id) DO NOTHING`,
		sessionID, userID, asStringField(body, "recipeId"), asStringField(body, "platform"),
		string(ctx), asStringField(body, "idempotencyKey"),
		now.Format(time.RFC3339Nano), expires, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
}

func persistRealtimeChunk(db *dbx.DB, sessionID, turnID string, userID, sequence int, transcript string, final bool) {
	if db == nil || !db.HasTable("realtime_voice_transcript_chunks") {
		return
	}
	isFinal := 0
	if final {
		isFinal = 1
	}
	_, _ = db.Exec(`INSERT INTO realtime_voice_transcript_chunks
		(session_id, turn_id, user_id, sequence, transcript, is_final, created_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(session_id, turn_id, sequence) DO UPDATE SET transcript=excluded.transcript, is_final=excluded.is_final`,
		sessionID, turnID, userID, sequence, transcript, isFinal)
}

type voiceSession struct {
	ID        string
	UserID    int
	ExpiresAt time.Time
	Events    []voiceEvent
	mu        sync.Mutex
}

type voiceEvent struct {
	Sequence int
	Type     string
	Payload  map[string]any
}

type voiceStore struct {
	mu       sync.Mutex
	sessions map[string]*voiceSession
}

func newVoiceStore() *voiceStore {
	return &voiceStore{sessions: make(map[string]*voiceSession)}
}

func (s *voiceStore) create(userID int) (sessionID string, expiresIn int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sessionID = "rv-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	expiresIn = 900
	s.sessions[sessionID] = &voiceSession{
		ID:        sessionID,
		UserID:    userID,
		ExpiresAt: time.Now().Add(time.Duration(expiresIn) * time.Second),
		Events:    []voiceEvent{},
	}
	return sessionID, expiresIn
}

func (s *voiceStore) get(sessionID string, userID int) (*voiceSession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[sessionID]
	if !ok || sess.UserID != userID {
		return nil, false
	}
	return sess, true
}

func (s *voiceStore) delete(sessionID string, userID int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[sessionID]
	if !ok || sess.UserID != userID {
		return false
	}
	delete(s.sessions, sessionID)
	return true
}

func (sess *voiceSession) appendEvent(eventType string, payload map[string]any) voiceEvent {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	seq := len(sess.Events) + 1
	ev := voiceEvent{Sequence: seq, Type: eventType, Payload: payload}
	sess.Events = append(sess.Events, ev)
	return ev
}

func (sess *voiceSession) eventsAfter(after int) []voiceEvent {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	out := make([]voiceEvent, 0)
	for _, ev := range sess.Events {
		if ev.Sequence > after {
			out = append(out, ev)
		}
	}
	return out
}

func voiceEventsJSON(events []voiceEvent) []map[string]any {
	out := make([]map[string]any, 0, len(events))
	for _, ev := range events {
		out = append(out, map[string]any{
			"sequence": ev.Sequence,
			"type":     ev.Type,
			"payload":  ev.Payload,
		})
	}
	return out
}

func marshalSSEData(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
