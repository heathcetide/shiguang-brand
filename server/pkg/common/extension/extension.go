// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package extension implements a Kubernetes-CRD-style dynamic type
// registration system inspired by Halo's Extension/GVK/Scheme model.
//
// # Design
//
// Every domain object is identified by a [GroupVersionKind] (GVK) and
// registered in a [Scheme]. The Scheme maps GVKs to Go types and provides
// JSON serialization/deserialization. All extensions share a common
// [Object] interface with metadata (name, labels, annotations, creation
// timestamp).
//
// This enables:
//   - Generic storage clients that work with any registered type.
//   - Dynamic API discovery (list all types, their GVK, and schema).
//   - Versioned, evolvable schemas (same kind, different versions).
//   - Plugin/extension registration at compile time or runtime.
//
// # Quick start
//
//	// 1. Define your domain type
//	type Post struct {
//	    extension.TypeMeta   `json:",inline"`
//	    extension.ObjectMeta `json:"metadata,omitempty"`
//	    Spec   PostSpec   `json:"spec"`
//	    Status PostStatus `json:"status,omitempty"`
//	}
//	func (p *Post) GetObjectMeta() *extension.ObjectMeta { return &p.ObjectMeta }
//
//	// 2. Register in a scheme
//	scheme := extension.NewScheme()
//	scheme.Register("blog.lingbyte.io", "v1", "Post", "posts", &Post{})
//
//	// 3. Use generic operations
//	gvk, _ := scheme.GVKForObject(&Post{})
//	obj, _ := scheme.New(gvk)
//	// obj is a fresh *Post
package extension

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"time"
)

// ──────────────────────────────────────────────
// GVK — GroupVersionKind
// ──────────────────────────────────────────────

// GroupVersionKind uniquely identifies a registered type.
type GroupVersionKind struct {
	Group   string
	Version string
	Kind    string
}

// String returns "group/version, Kind=kind".
func (g GroupVersionKind) String() string {
	return fmt.Sprintf("%s/%s, Kind=%s", g.Group, g.Version, g.Kind)
}

// APIVersion returns "group/version".
func (g GroupVersionKind) APIVersion() string {
	if g.Group == "" {
		return g.Version
	}
	return fmt.Sprintf("%s/%s", g.Group, g.Version)
}

// GroupVersionKindFromAPIVersion parses "group/version" and a kind.
func GroupVersionKindFromAPIVersion(apiVersion, kind string) (GroupVersionKind, error) {
	gvk := GroupVersionKind{Kind: kind}
	if i := indexOf(apiVersion, '/'); i >= 0 {
		gvk.Group = apiVersion[:i]
		gvk.Version = apiVersion[i+1:]
	} else {
		gvk.Version = apiVersion
	}
	if gvk.Version == "" || gvk.Kind == "" {
		return gvk, fmt.Errorf("invalid apiVersion=%q kind=%q", apiVersion, kind)
	}
	return gvk, nil
}

func indexOf(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

// ──────────────────────────────────────────────
// TypeMeta — embedded in every Extension
// ──────────────────────────────────────────────

// TypeMeta is embedded in every Extension to carry its GVK.
type TypeMeta struct {
	APIVersion string `json:"apiVersion,omitempty"`
	Kind       string `json:"kind,omitempty"`
}

// ──────────────────────────────────────────────
// ObjectMeta — metadata for every Extension
// ──────────────────────────────────────────────

// ObjectMeta is metadata common to all Extensions.
type ObjectMeta struct {
	// Name is the unique identifier within a scope.
	Name string `json:"name,omitempty"`

	// Labels are key-value pairs for filtering.
	Labels map[string]string `json:"labels,omitempty"`

	// Annotations are key-value pairs for arbitrary metadata.
	Annotations map[string]string `json:"annotations,omitempty"`

	// CreationTimestamp is when the object was created.
	CreationTimestamp time.Time `json:"creationTimestamp,omitempty"`

	// Version is used for optimistic concurrency control.
	// Incremented on each update.
	Version int64 `json:"version,omitempty"`

	// Deleted marks the object as soft-deleted.
	Deleted bool `json:"deleted,omitempty"`
}

// ──────────────────────────────────────────────
// Object interface
// ──────────────────────────────────────────────

// Object is the interface every Extension must implement.
// Embedding TypeMeta and ObjectMeta satisfies the metadata requirements.
type Object interface {
	// GetObjectMeta returns a pointer to the object's metadata.
	GetObjectMeta() *ObjectMeta
}

// ──────────────────────────────────────────────
// Scheme — type registry
// ──────────────────────────────────────────────

// typeEntry holds registration info for a type.
type typeEntry struct {
	gvk       GroupVersionKind
	plural    string
	singular  string
	goType    reflect.Type
	prototype Object
}

// Scheme is a registry of Extension types.
type Scheme struct {
	mu       sync.RWMutex
	types    map[GroupVersionKind]*typeEntry
	byType   map[reflect.Type]*typeEntry
	byPlural map[string]*typeEntry // group/version -> plural -> entry
}

// NewScheme creates an empty Scheme.
func NewScheme() *Scheme {
	return &Scheme{
		types:    make(map[GroupVersionKind]*typeEntry),
		byType:   make(map[reflect.Type]*typeEntry),
		byPlural: make(map[string]*typeEntry),
	}
}

// Register adds a type to the scheme.
//
// prototype must be a pointer to a struct that implements Object.
// The scheme stores the prototype's type and uses it to create new
// instances via reflection.
func (s *Scheme) Register(group, version, kind, plural string, prototype Object) error {
	if kind == "" {
		return errors.New("extension: kind cannot be empty")
	}
	if plural == "" {
		plural = kind + "s"
	}
	if prototype == nil {
		return errors.New("extension: prototype cannot be nil")
	}

	// Verify prototype implements Object.
	goType := reflect.TypeOf(prototype)
	if goType.Kind() != reflect.Ptr {
		return fmt.Errorf("extension: prototype must be a pointer, got %s", goType.Kind())
	}

	gvk := GroupVersionKind{Group: group, Version: version, Kind: kind}
	entry := &typeEntry{
		gvk:       gvk,
		plural:    plural,
		singular:  kind,
		goType:    goType,
		prototype: prototype,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.types[gvk]; exists {
		return fmt.Errorf("extension: GVK %s already registered", gvk)
	}
	if _, exists := s.byType[goType]; exists {
		return fmt.Errorf("extension: Go type %s already registered", goType)
	}

	s.types[gvk] = entry
	s.byType[goType] = entry

	// Index by group/version + plural for REST-style lookups.
	pluralKey := fmt.Sprintf("%s/%s/%s", group, version, plural)
	s.byPlural[pluralKey] = entry

	return nil
}

// Unregister removes a type from the scheme.
func (s *Scheme) Unregister(gvk GroupVersionKind) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry, ok := s.types[gvk]
	if !ok {
		return fmt.Errorf("extension: GVK %s not registered", gvk)
	}

	delete(s.types, gvk)
	delete(s.byType, entry.goType)
	pluralKey := fmt.Sprintf("%s/%s/%s", gvk.Group, gvk.Version, entry.plural)
	delete(s.byPlural, pluralKey)

	return nil
}

// New creates a fresh instance of the type identified by gvk.
func (s *Scheme) New(gvk GroupVersionKind) (Object, error) {
	s.mu.RLock()
	entry, ok := s.types[gvk]
	s.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("extension: GVK %s not registered", gvk)
	}

	val := reflect.New(entry.goType.Elem())
	obj, ok := val.Interface().(Object)
	if !ok {
		return nil, fmt.Errorf("extension: type for %s does not implement Object", gvk)
	}

	// Set TypeMeta.
	meta := obj.GetObjectMeta()
	_ = meta
	// Set APIVersion and Kind via reflection on TypeMeta field.
	setTypeMeta(val, gvk.APIVersion(), gvk.Kind)

	return obj, nil
}

// GVKForObject returns the GVK for a given Object instance.
func (s *Scheme) GVKForObject(obj Object) (GroupVersionKind, error) {
	if obj == nil {
		return GroupVersionKind{}, errors.New("extension: nil object")
	}
	goType := reflect.TypeOf(obj)
	s.mu.RLock()
	entry, ok := s.byType[goType]
	s.mu.RUnlock()
	if !ok {
		return GroupVersionKind{}, fmt.Errorf("extension: type %s not registered", goType)
	}
	return entry.gvk, nil
}

// Object returns the prototype for a GVK (for introspection only).
func (s *Scheme) Object(gvk GroupVersionKind) (Object, error) {
	s.mu.RLock()
	entry, ok := s.types[gvk]
	s.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("extension: GVK %s not registered", gvk)
	}
	return entry.prototype, nil
}

// AllGVKs returns all registered GroupVersionKinds.
func (s *Scheme) AllGVKs() []GroupVersionKind {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]GroupVersionKind, 0, len(s.types))
	for gvk := range s.types {
		result = append(result, gvk)
	}
	return result
}

// IsRegistered checks if a GVK is registered.
func (s *Scheme) IsRegistered(gvk GroupVersionKind) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.types[gvk]
	return ok
}

// Plural returns the plural form for a GVK.
func (s *Scheme) Plural(gvk GroupVersionKind) (string, error) {
	s.mu.RLock()
	entry, ok := s.types[gvk]
	s.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("extension: GVK %s not registered", gvk)
	}
	return entry.plural, nil
}

// LookupByPlural finds a type by group/version/plural (REST-style).
func (s *Scheme) LookupByPlural(group, version, plural string) (GroupVersionKind, error) {
	pluralKey := fmt.Sprintf("%s/%s/%s", group, version, plural)
	s.mu.RLock()
	entry, ok := s.byPlural[pluralKey]
	s.mu.RUnlock()
	if !ok {
		return GroupVersionKind{}, fmt.Errorf("extension: no type for %s", pluralKey)
	}
	return entry.gvk, nil
}

// Count returns the number of registered types.
func (s *Scheme) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.types)
}

// ──────────────────────────────────────────────
// Serialization helpers
// ──────────────────────────────────────────────

// MarshalJSON serializes an Object to JSON, injecting apiVersion and kind.
func (s *Scheme) MarshalJSON(obj Object) ([]byte, error) {
	gvk, err := s.GVKForObject(obj)
	if err != nil {
		return nil, err
	}
	// Set TypeMeta fields via reflection.
	setTypeMeta(reflect.ValueOf(obj), gvk.APIVersion(), gvk.Kind)
	return json.Marshal(obj)
}

// UnmarshalJSON deserializes JSON into an Object, using the apiVersion/kind
// in the JSON to determine the target type.
func (s *Scheme) UnmarshalJSON(data []byte) (Object, error) {
	// First pass: extract apiVersion and kind.
	var tm TypeMeta
	if err := json.Unmarshal(data, &tm); err != nil {
		return nil, fmt.Errorf("extension: failed to parse type meta: %w", err)
	}
	gvk, err := GroupVersionKindFromAPIVersion(tm.APIVersion, tm.Kind)
	if err != nil {
		return nil, err
	}
	obj, err := s.New(gvk)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, obj); err != nil {
		return nil, fmt.Errorf("extension: failed to unmarshal into %s: %w", gvk, err)
	}
	return obj, nil
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// setTypeMeta sets the APIVersion and Kind fields on an object's TypeMeta
// via reflection. The value must be a pointer to a struct containing a
// TypeMeta field (embedded or named).
func setTypeMeta(val reflect.Value, apiVersion, kind string) {
	if val.Kind() == reflect.Ptr {
		val = val.Elem()
	}
	if val.Kind() != reflect.Struct {
		return
	}
	// Look for embedded TypeMeta or a field named "TypeMeta".
	field := val.FieldByName("TypeMeta")
	if !field.IsValid() || !field.CanSet() {
		return
	}
	if field.Kind() == reflect.Struct {
		apiVersionField := field.FieldByName("APIVersion")
		kindField := field.FieldByName("Kind")
		if apiVersionField.CanSet() {
			apiVersionField.SetString(apiVersion)
		}
		if kindField.CanSet() {
			kindField.SetString(kind)
		}
	}
}
