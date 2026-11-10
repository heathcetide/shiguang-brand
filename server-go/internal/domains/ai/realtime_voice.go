// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"encoding/json"
	"strconv"
	"sync"
	"time"
)

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
