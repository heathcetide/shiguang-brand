// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package configcenter implements an Apollo-style hierarchical configuration
// center with versioned releases, rollback, and long-polling notifications.
//
// # Design
//
// Configuration is organized into four dimensions:
//
//  1. Application (appId) — e.g. "payment-service"
//  2. Environment — e.g. "prod"
//  3. Cluster — e.g. "default", "dc-east"
//  4. Namespace — e.g. "application", "database"
//
// Resolution follows Apollo's fallback logic:
//
//	app + cluster + namespace
//	  → fallback to app + default-cluster + namespace
//	  → fallback to public namespace
//	  → return 304 if releaseKey matches
//
// Each publish creates an immutable [Release] with a unique releaseKey.
// Rollback marks the latest release as abandoned; the previous active
// release becomes current.
//
// # Quick start
//
//	cc := configcenter.New()
//	cc.AddApp("payment", "prod")
//	cc.AddNamespace("payment", "prod", "default", "application", true)
//	cc.SetItem("payment", "prod", "default", "application", "timeout", "5000")
//
//	release, _ := cc.Publish("payment", "prod", "default", "application", "operator")
//	config := release.Config["timeout"] // "5000"
//
//	// Long-poll for changes
//	notify := cc.Watch("payment", "prod", "default", "application")
//	defer notify.Close()
//	select {
//	case <-notify.Ch():
//	    // config changed
//	case <-time.After(60 * time.Second):
//	    // timeout
//	}
package configcenter

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// ──────────────────────────────────────────────
// Core types
// ──────────────────────────────────────────────

// Item is a single key-value configuration entry.
type Item struct {
	Key     string
	Value   string
	Comment string
}

// Namespace is a collection of configuration items.
type Namespace struct {
	mu    sync.RWMutex
	items map[string]*Item

	AppID    string
	Env      string
	Cluster  string
	Name     string
	IsPublic bool
}

// SetItem sets or updates a configuration item.
func (n *Namespace) SetItem(key, value string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.items == nil {
		n.items = make(map[string]*Item)
	}
	n.items[key] = &Item{Key: key, Value: value}
}

// GetItem returns a configuration item by key.
func (n *Namespace) GetItem(key string) (*Item, bool) {
	n.mu.RLock()
	defer n.mu.RUnlock()
	item, ok := n.items[key]
	return item, ok
}

// DeleteItem removes a configuration item.
func (n *Namespace) DeleteItem(key string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	delete(n.items, key)
}

// AllItems returns a copy of all items.
func (n *Namespace) AllItems() map[string]string {
	n.mu.RLock()
	defer n.mu.RUnlock()
	out := make(map[string]string, len(n.items))
	for k, v := range n.items {
		out[k] = v.Value
	}
	return out
}

// Release is an immutable snapshot of a namespace's configuration.
type Release struct {
	ID          int64
	AppID       string
	Env         string
	Cluster     string
	Namespace   string
	ReleaseKey  string
	Config      map[string]string
	Comment     string
	Operator    string
	CreatedAt   time.Time
	Abandoned   bool
	AbandonedAt time.Time
}

// ConfigResult is the result of a config query.
type ConfigResult struct {
	AppID       string
	Cluster     string
	Namespace   string
	ReleaseKey  string
	Config      map[string]string
	NotModified bool // true when releaseKey matches client's version
}

// ──────────────────────────────────────────────
// ConfigCenter
// ──────────────────────────────────────────────

// ConfigCenter is the in-memory configuration center.
// In production, this would be backed by a database.
type ConfigCenter struct {
	mu         sync.RWMutex
	apps       map[string]bool
	namespaces map[string]*Namespace // key: appId/env/cluster/namespace
	releases   map[string][]*Release // key: appId/env/cluster/namespace
	releaseID  atomic.Int64

	// Watchers for long-polling notifications.
	watchersMu sync.Mutex
	watchers   map[string][]*Watcher // key: appId/env/cluster/namespace
}

// New creates a new ConfigCenter.
func New() *ConfigCenter {
	return &ConfigCenter{
		apps:       make(map[string]bool),
		namespaces: make(map[string]*Namespace),
		releases:   make(map[string][]*Release),
		watchers:   make(map[string][]*Watcher),
	}
}

// namespaceKey builds the map key for a namespace.
func namespaceKey(appID, env, cluster, namespace string) string {
	return fmt.Sprintf("%s/%s/%s/%s", appID, env, cluster, namespace)
}

// AddApp registers an application.
func (cc *ConfigCenter) AddApp(appID string, env string) {
	cc.mu.Lock()
	defer cc.mu.Unlock()
	key := fmt.Sprintf("%s/%s", appID, env)
	cc.apps[key] = true
}

// AddNamespace creates a namespace. If isPublic is true, the namespace
// can be shared across applications.
func (cc *ConfigCenter) AddNamespace(appID, env, cluster, namespace string, isPublic bool) error {
	cc.mu.Lock()
	defer cc.mu.Unlock()

	// Auto-create default cluster if not specified.
	if cluster == "" {
		cluster = "default"
	}

	key := namespaceKey(appID, env, cluster, namespace)
	if _, exists := cc.namespaces[key]; exists {
		return fmt.Errorf("namespace %s already exists", key)
	}

	cc.namespaces[key] = &Namespace{
		items:    make(map[string]*Item),
		AppID:    appID,
		Env:      env,
		Cluster:  cluster,
		Name:     namespace,
		IsPublic: isPublic,
	}
	return nil
}

// SetItem sets a configuration item in a namespace.
func (cc *ConfigCenter) SetItem(appID, env, cluster, namespace, key, value string) error {
	cc.mu.RLock()
	ns, ok := cc.namespaces[namespaceKey(appID, env, cluster, namespace)]
	cc.mu.RUnlock()
	if !ok {
		return fmt.Errorf("namespace %s not found", namespaceKey(appID, env, cluster, namespace))
	}
	ns.SetItem(key, value)
	return nil
}

// DeleteItem removes a configuration item from a namespace.
func (cc *ConfigCenter) DeleteItem(appID, env, cluster, namespace, key string) error {
	cc.mu.RLock()
	ns, ok := cc.namespaces[namespaceKey(appID, env, cluster, namespace)]
	cc.mu.RUnlock()
	if !ok {
		return fmt.Errorf("namespace not found")
	}
	ns.DeleteItem(key)
	return nil
}

// Publish creates an immutable release of the namespace's current configuration.
func (cc *ConfigCenter) Publish(appID, env, cluster, namespace, operator string) (*Release, error) {
	cc.mu.Lock()
	defer cc.mu.Unlock()

	key := namespaceKey(appID, env, cluster, namespace)
	ns, ok := cc.namespaces[key]
	if !ok {
		return nil, fmt.Errorf("namespace %s not found", key)
	}

	config := ns.AllItems()
	releaseKey := generateReleaseKey(appID, env, cluster, namespace, config)

	release := &Release{
		ID:         cc.releaseID.Add(1),
		AppID:      appID,
		Env:        env,
		Cluster:    cluster,
		Namespace:  namespace,
		ReleaseKey: releaseKey,
		Config:     config,
		Operator:   operator,
		CreatedAt:  time.Now(),
	}

	cc.releases[key] = append(cc.releases[key], release)

	// Notify watchers (non-blocking).
	cc.notifyWatchers(appID, env, cluster, namespace)

	return release, nil
}

// Rollback abandons the latest active release, making the previous one current.
func (cc *ConfigCenter) Rollback(appID, env, cluster, namespace string) error {
	cc.mu.Lock()
	defer cc.mu.Unlock()

	key := namespaceKey(appID, env, cluster, namespace)
	releases := cc.releases[key]
	if len(releases) == 0 {
		return errors.New("no releases to rollback")
	}

	// Find the latest non-abandoned release.
	latestIdx := -1
	for i := len(releases) - 1; i >= 0; i-- {
		if !releases[i].Abandoned {
			latestIdx = i
			break
		}
	}
	if latestIdx < 0 {
		return errors.New("no active release to rollback")
	}
	if latestIdx == 0 {
		return errors.New("cannot rollback the only release")
	}

	releases[latestIdx].Abandoned = true
	releases[latestIdx].AbandonedAt = time.Now()

	// Notify watchers.
	cc.notifyWatchers(appID, env, cluster, namespace)
	return nil
}

// GetConfig retrieves the resolved configuration for a namespace.
// It follows Apollo's fallback logic:
//  1. Try app + cluster + namespace
//  2. Fallback to app + default-cluster + namespace
//  3. Fallback to public namespace
//
// If clientReleaseKey matches the server's release key, returns NotModified=true.
func (cc *ConfigCenter) GetConfig(appID, env, cluster, namespace, clientReleaseKey string) (*ConfigResult, error) {
	cc.mu.RLock()
	defer cc.mu.RUnlock()

	// Try the requested cluster first.
	release := cc.findLatestRelease(appID, env, cluster, namespace)

	// Fallback to default cluster.
	if release == nil && cluster != "default" {
		release = cc.findLatestRelease(appID, env, "default", namespace)
	}

	// Fallback to public namespace (search all apps for a public namespace
	// with the same name).
	if release == nil {
		release = cc.findPublicNamespaceRelease(env, namespace)
	}

	if release == nil {
		return nil, fmt.Errorf("no configuration found for %s/%s/%s/%s", appID, env, cluster, namespace)
	}

	if clientReleaseKey == release.ReleaseKey {
		return &ConfigResult{
			AppID:       appID,
			Cluster:     cluster,
			Namespace:   namespace,
			ReleaseKey:  release.ReleaseKey,
			NotModified: true,
		}, nil
	}

	return &ConfigResult{
		AppID:      appID,
		Cluster:    cluster,
		Namespace:  namespace,
		ReleaseKey: release.ReleaseKey,
		Config:     release.Config,
	}, nil
}

// findLatestRelease returns the latest non-abandoned release for the given
// app/env/cluster/namespace, or nil if none exists.
func (cc *ConfigCenter) findLatestRelease(appID, env, cluster, namespace string) *Release {
	key := namespaceKey(appID, env, cluster, namespace)
	releases := cc.releases[key]
	for i := len(releases) - 1; i >= 0; i-- {
		if !releases[i].Abandoned {
			return releases[i]
		}
	}
	return nil
}

// findPublicNamespaceRelease searches all apps for a public namespace
// with the given name and returns its latest release.
func (cc *ConfigCenter) findPublicNamespaceRelease(env, namespace string) *Release {
	for key, ns := range cc.namespaces {
		if ns.IsPublic && ns.Env == env && ns.Name == namespace {
			releases := cc.releases[key]
			for i := len(releases) - 1; i >= 0; i-- {
				if !releases[i].Abandoned {
					return releases[i]
				}
			}
		}
	}
	return nil
}

// GetReleaseHistory returns all releases for a namespace.
func (cc *ConfigCenter) GetReleaseHistory(appID, env, cluster, namespace string) ([]*Release, error) {
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	key := namespaceKey(appID, env, cluster, namespace)
	releases, ok := cc.releases[key]
	if !ok {
		return nil, fmt.Errorf("namespace not found")
	}
	// Return copies.
	out := make([]*Release, len(releases))
	copy(out, releases)
	return out, nil
}

// ──────────────────────────────────────────────
// Long-polling notification
// ──────────────────────────────────────────────

// Watcher receives notifications when a namespace's configuration changes.
type Watcher struct {
	key    string
	ch     chan struct{}
	closed atomic.Bool
	cc     *ConfigCenter
}

// Ch returns a channel that is signaled when the namespace changes.
func (w *Watcher) Ch() <-chan struct{} { return w.ch }

// Close removes the watcher from the config center.
func (w *Watcher) Close() {
	if w.closed.CompareAndSwap(false, true) {
		w.cc.removeWatcher(w)
		close(w.ch)
	}
}

// Watch registers a watcher for a namespace. The returned Watcher's Ch()
// channel will be signaled when the namespace's configuration changes
// (publish or rollback).
func (cc *ConfigCenter) Watch(appID, env, cluster, namespace string) *Watcher {
	key := namespaceKey(appID, env, cluster, namespace)
	w := &Watcher{
		key: key,
		ch:  make(chan struct{}, 1),
		cc:  cc,
	}

	cc.watchersMu.Lock()
	cc.watchers[key] = append(cc.watchers[key], w)
	cc.watchersMu.Unlock()

	return w
}

func (cc *ConfigCenter) removeWatcher(w *Watcher) {
	cc.watchersMu.Lock()
	defer cc.watchersMu.Unlock()
	watchers := cc.watchers[w.key]
	for i, watcher := range watchers {
		if watcher == w {
			cc.watchers[w.key] = append(watchers[:i], watchers[i+1:]...)
			break
		}
	}
}

// notifyWatchers signals all watchers of a namespace. Called under cc.mu lock.
func (cc *ConfigCenter) notifyWatchers(appID, env, cluster, namespace string) {
	key := namespaceKey(appID, env, cluster, namespace)
	cc.watchersMu.Lock()
	watchers := cc.watchers[key]
	cc.watchersMu.Unlock()

	for _, w := range watchers {
		select {
		case w.ch <- struct{}{}:
		default:
			// Drop if watcher is slow (non-blocking).
		}
	}
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// generateReleaseKey creates a unique key for a release based on its content.
func generateReleaseKey(appID, env, cluster, namespace string, config map[string]string) string {
	// Sort keys for deterministic hash.
	keys := make([]string, 0, len(config))
	for k := range config {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	h := sha1.New()
	fmt.Fprintf(h, "%s/%s/%s/%s|%d", appID, env, cluster, namespace, time.Now().UnixNano())
	for _, k := range keys {
		fmt.Fprintf(h, "|%s=%s", k, config[k])
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}
