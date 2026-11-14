package captcha

import (
	"errors"
	"strings"
	"sync"
	"time"
)

// Store is the interface for captcha storage backends.
type Store interface {
	Set(id string, data interface{}, expires time.Time) error
	Get(id string) (interface{}, error)
	Delete(id string) error
	VerifyWithFunc(id string, input interface{}, compareFunc func(stored, input interface{}) bool) (bool, error)
	VerifyWithFuncWithoutDelete(id string, input interface{}, compareFunc func(stored, input interface{}) bool) (bool, error)
}

// MemoryStore is an in-process implementation of Store backed by a map.
type MemoryStore struct {
	data map[string]storeData
	mu   sync.Mutex
}

type storeData struct {
	data    interface{}
	expires time.Time
}

// NewMemoryStore creates a new in-memory store.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		data: make(map[string]storeData),
	}
}

func (s *MemoryStore) Set(id string, data interface{}, expires time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[id] = storeData{
		data:    data,
		expires: expires,
	}
	go s.cleanup()
	return nil
}

func (s *MemoryStore) Get(id string) (interface{}, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.data[id]
	if !ok {
		return nil, errors.New("captcha not found")
	}
	if time.Now().After(d.expires) {
		delete(s.data, id)
		return nil, errors.New("captcha expired")
	}
	return d.data, nil
}

func (s *MemoryStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, id)
	return nil
}

// VerifyWithFunc checks the captcha and deletes it on success.
func (s *MemoryStore) VerifyWithFunc(id string, input interface{}, compareFunc func(stored, input interface{}) bool) (bool, error) {
	stored, err := s.Get(id)
	if err != nil {
		return false, err
	}
	if compareFunc == nil {
		// Default: case-insensitive string comparison.
		if storedStr, ok := stored.(string); ok {
			if inputStr, ok := input.(string); ok {
				if strings.EqualFold(storedStr, inputStr) {
					s.Delete(id)
					return true, nil
				}
			}
		}
		return false, nil
	}
	if compareFunc(stored, input) {
		s.Delete(id)
		return true, nil
	}
	return false, nil
}

// VerifyWithFuncWithoutDelete checks the captcha without removing it (for pre-verification).
func (s *MemoryStore) VerifyWithFuncWithoutDelete(id string, input interface{}, compareFunc func(stored, input interface{}) bool) (bool, error) {
	stored, err := s.Get(id)
	if err != nil {
		return false, err
	}
	if compareFunc == nil {
		// Default: case-insensitive string comparison.
		if storedStr, ok := stored.(string); ok {
			if inputStr, ok := input.(string); ok {
				return strings.EqualFold(storedStr, inputStr), nil
			}
		}
		return false, nil
	}
	return compareFunc(stored, input), nil
}

func (s *MemoryStore) cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for id, d := range s.data {
		if now.After(d.expires) {
			delete(s.data, id)
		}
	}
}
