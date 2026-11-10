// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package response

import "fmt"

// MessageResolver resolves an i18n message key to a localized string.
// Implementations are typically backed by an i18n.Manager, but any
// source (static map, database, remote service) can satisfy this
// interface.
//
// The args are optional format arguments. If the resolved template
// contains verbs (e.g. %d, %s), the implementation should apply them.
type MessageResolver interface {
	Resolve(key string, args ...any) string
}

// ResolverFunc is a function adapter for MessageResolver.
type ResolverFunc func(key string, args ...any) string

// Resolve calls the underlying function.
func (f ResolverFunc) Resolve(key string, args ...any) string {
	if f == nil {
		return ""
	}
	return f(key, args...)
}

// StaticResolver is a simple map-backed resolver. It is useful for
// testing and for applications that do not need full i18n support.
//
// Missing keys fall back to the key itself. If the resolved template
// contains format verbs and args are provided, fmt.Sprintf is applied.
type StaticResolver struct {
	Messages map[string]string
}

// Resolve looks up the key in the map and applies fmt.Sprintf if args
// are provided.
func (r *StaticResolver) Resolve(key string, args ...any) string {
	if r == nil {
		return ""
	}
	tmpl, ok := r.Messages[key]
	if !ok {
		return key
	}
	if len(args) == 0 {
		return tmpl
	}
	return fmt.Sprintf(tmpl, args...)
}

// NoopResolver always returns the key unchanged. It is the default when
// no resolver is configured.
var NoopResolver MessageResolver = ResolverFunc(func(key string, _ ...any) string {
	return key
})

// ChainResolver tries each resolver in order, returning the first
// non-empty result. If all resolvers return empty, the key is returned.
type ChainResolver struct {
	Resolvers []MessageResolver
}

// Resolve tries each resolver in order.
func (r *ChainResolver) Resolve(key string, args ...any) string {
	if r == nil {
		return key
	}
	for _, res := range r.Resolvers {
		if res == nil {
			continue
		}
		if msg := res.Resolve(key, args...); msg != "" && msg != key {
			return msg
		}
	}
	return key
}
