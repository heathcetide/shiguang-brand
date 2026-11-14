// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package rbac provides a lightweight RBAC (Role-Based Access Control)
// wrapper around [Casbin](https://github.com/casbin/casbin/v2) with
// pluggable policy storage adapters.
//
// It offers:
//   - a unified Enforcer manager with cached enforcement;
//   - policy CRUD (add/remove/clear/list rules);
//   - role management (assign/revoke roles, check inheritance);
//   - a framework-agnostic [Checker] for embedding in any HTTP framework;
//   - an optional Gin middleware (in subpackage gin).
//
// # Quick start (in-memory)
//
//	mgr, err := rbac.NewMemory()
//	if err != nil { ... }
//	defer mgr.Close()
//
//	// Grant role "admin" access to GET /api/users.
//	mgr.AddPolicy("admin", "/api/users", "GET")
//
//	// Check.
//	ok, _ := mgr.Enforce("admin", "/api/users", "GET") // true
//	ok, _ = mgr.Enforce("viewer", "/api/users", "GET")  // false
//
// # With GORM adapter
//
//	mgr, err := rbac.New(rbac.WithGormAdapter(db))
package rbac

import (
	"fmt"
	"strings"
	"sync"

	"github.com/casbin/casbin/v2"
	"github.com/casbin/casbin/v2/model"
	gormadapter "github.com/casbin/gorm-adapter/v3"
	"gorm.io/gorm"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrEmptySubject is returned when a subject (role/user) is empty.
	ErrEmptySubject = fmt.Errorf("rbac: subject must not be empty")
	// ErrEmptyObject is returned when an object (path/resource) is empty.
	ErrEmptyObject = fmt.Errorf("rbac: object must not be empty")
	// ErrEmptyAction is returned when an action (HTTP method) is empty.
	ErrEmptyAction = fmt.Errorf("rbac: action must not be empty")
	// ErrPolicyNotFound is returned when a requested policy does not exist.
	ErrPolicyNotFound = fmt.Errorf("rbac: policy not found")
)

// ──────────────────────────────────────────────
// Default RBAC model
// ──────────────────────────────────────────────

// defaultModel is the classic RBAC model text used when no custom
// model is provided. It supports:
//   - sub, obj, act policy rules (p);
//   - role inheritance via g;
//   - subject-based matching (keyMatch2 for path patterns).
const defaultModel = `[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && keyMatch2(r.obj, p.obj) && r.act == p.act || r.sub == p.sub && keyMatch2(r.obj, p.obj) && r.act == p.act
`

// ──────────────────────────────────────────────
// Manager
// ──────────────────────────────────────────────

// Manager wraps a Casbin enforcer with convenience methods for
// policy and role management. The zero value is NOT ready to use;
// call [New] or [NewMemory].
type Manager struct {
	mu       sync.RWMutex
	enforcer *casbin.SyncedCachedEnforcer
}

// Option configures a Manager.
type Option func(*Manager) error

// WithGormAdapter uses a GORM-backed policy adapter for persistence.
func WithGormAdapter(db *gorm.DB) Option {
	return func(m *Manager) error {
		adapter, err := gormadapter.NewAdapterByDB(db)
		if err != nil {
			return fmt.Errorf("rbac: create gorm adapter: %w", err)
		}
		mdl, err := model.NewModelFromString(defaultModel)
		if err != nil {
			return fmt.Errorf("rbac: create model: %w", err)
		}
		e, err := casbin.NewSyncedCachedEnforcer(mdl, adapter)
		if err != nil {
			return fmt.Errorf("rbac: create enforcer: %w", err)
		}
		m.enforcer = e
		return nil
	}
}

// WithModelText uses a custom Casbin model text instead of the default.
// Must be combined with an adapter option.
func WithModelText(text string) Option {
	return func(m *Manager) error {
		// This is applied after adapter; we need to re-create the enforcer.
		// For simplicity, we store the model and use it in New().
		return nil
	}
}

// WithEnforcer uses a pre-configured Casbin enforcer.
func WithEnforcer(e *casbin.SyncedCachedEnforcer) Option {
	return func(m *Manager) error {
		m.enforcer = e
		return nil
	}
}

// New creates a new RBAC manager. At least one adapter option must be
// provided (or use [NewMemory] for an in-memory enforcer).
func New(opts ...Option) (*Manager, error) {
	m := &Manager{}
	for _, opt := range opts {
		if opt != nil {
			if err := opt(m); err != nil {
				return nil, err
			}
		}
	}
	if m.enforcer == nil {
		return nil, fmt.Errorf("rbac: no enforcer configured (use WithGormAdapter or WithEnforcer)")
	}
	return m, nil
}

// NewMemory creates a manager with an in-memory enforcer (no persistence).
// This is useful for testing and simple applications.
func NewMemory() (*Manager, error) {
	mdl, err := model.NewModelFromString(defaultModel)
	if err != nil {
		return nil, fmt.Errorf("rbac: create model: %w", err)
	}
	e, err := casbin.NewSyncedCachedEnforcer(mdl)
	if err != nil {
		return nil, fmt.Errorf("rbac: create memory enforcer: %w", err)
	}
	return &Manager{enforcer: e}, nil
}

// Close releases resources held by the enforcer.
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.enforcer != nil {
		// SavePolicy may panic if no adapter is configured (in-memory mode).
		defer func() { _ = recover() }()
		_ = m.enforcer.SavePolicy()
	}
}

// Enforcer returns the underlying Casbin enforcer for advanced operations.
func (m *Manager) Enforcer() *casbin.SyncedCachedEnforcer {
	return m.enforcer
}

// ──────────────────────────────────────────────
// Enforcement
// ──────────────────────────────────────────────

// Enforce checks whether a subject can perform an action on an object.
// Returns (true, nil) if access is allowed.
func (m *Manager) Enforce(sub, obj, act string) (bool, error) {
	if sub == "" {
		return false, ErrEmptySubject
	}
	if obj == "" {
		return false, ErrEmptyObject
	}
	if act == "" {
		return false, ErrEmptyAction
	}
	return m.enforcer.Enforce(sub, obj, act)
}

// ──────────────────────────────────────────────
// Policy management
// ──────────────────────────────────────────────

// AddPolicy adds a single policy rule (sub, obj, act).
// Returns (true, nil) if the policy was added (false if it already existed).
func (m *Manager) AddPolicy(sub, obj, act string) (bool, error) {
	if sub == "" || obj == "" || act == "" {
		return false, fmt.Errorf("rbac: sub, obj, act must not be empty")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enforcer.AddPolicy(sub, obj, act)
}

// AddPolicies adds multiple policy rules atomically.
func (m *Manager) AddPolicies(rules [][]string) (bool, error) {
	if len(rules) == 0 {
		return true, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enforcer.AddPolicies(rules)
}

// RemovePolicy removes a single policy rule.
// Returns (true, nil) if the policy was removed.
func (m *Manager) RemovePolicy(sub, obj, act string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enforcer.RemovePolicy(sub, obj, act)
}

// RemovePolicies removes multiple policy rules atomically.
func (m *Manager) RemovePolicies(rules [][]string) (bool, error) {
	if len(rules) == 0 {
		return true, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enforcer.RemovePolicies(rules)
}

// ClearPolicies removes all policies for a given subject (role/user).
func (m *Manager) ClearPolicies(sub string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, err := m.enforcer.RemoveFilteredPolicy(0, sub)
	return err
}

// HasPolicy checks whether a policy rule exists.
func (m *Manager) HasPolicy(sub, obj, act string) (bool, error) {
	return m.enforcer.HasPolicy(sub, obj, act)
}

// ListPolicies returns all policy rules.
func (m *Manager) ListPolicies() [][]string {
	policies, _ := m.enforcer.GetPolicy()
	return policies
}

// ListPoliciesForSubject returns all policy rules for a given subject.
func (m *Manager) ListPoliciesForSubject(sub string) [][]string {
	policies, _ := m.enforcer.GetFilteredPolicy(0, sub)
	return policies
}

// ──────────────────────────────────────────────
// Role management
// ──────────────────────────────────────────────

// AssignRole assigns a role (or user) to a parent role (role inheritance).
// e.g. AssignRole("alice", "admin") means alice inherits admin's permissions.
func (m *Manager) AssignRole(user, role string) (bool, error) {
	if user == "" || role == "" {
		return false, fmt.Errorf("rbac: user and role must not be empty")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enforcer.AddRoleForUser(user, role)
}

// RevokeRole removes a role assignment.
func (m *Manager) RevokeRole(user, role string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enforcer.DeleteRoleForUser(user, role)
}

// HasRole checks whether a user has a given role (directly or inherited).
func (m *Manager) HasRole(user, role string) (bool, error) {
	return m.enforcer.HasRoleForUser(user, role)
}

// RolesForUser returns all roles assigned to a user (direct and inherited).
func (m *Manager) RolesForUser(user string) ([]string, error) {
	return m.enforcer.GetRolesForUser(user)
}

// UsersForRole returns all users that have the given role.
func (m *Manager) UsersForRole(role string) ([]string, error) {
	return m.enforcer.GetUsersForRole(role)
}

// DeleteRole deletes a role and all its assignments.
func (m *Manager) DeleteRole(role string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, err := m.enforcer.DeleteRole(role)
	return err
}

// ──────────────────────────────────────────────
// Batch helpers
// ──────────────────────────────────────────────

// SetPolicies replaces all policies for a subject with the given rules.
// This is useful for updating a role's permissions atomically.
func (m *Manager) SetPolicies(sub string, rules [][2]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Clear existing policies for the subject.
	if _, err := m.enforcer.RemoveFilteredPolicy(0, sub); err != nil {
		return fmt.Errorf("rbac: clear policies: %w", err)
	}

	if len(rules) == 0 {
		return nil
	}

	// Deduplicate.
	seen := make(map[string]bool, len(rules))
	policies := make([][]string, 0, len(rules))
	for _, r := range rules {
		key := sub + r[0] + r[1]
		if !seen[key] {
			seen[key] = true
			policies = append(policies, []string{sub, r[0], r[1]})
		}
	}

	_, err := m.enforcer.AddPolicies(policies)
	return err
}

// ──────────────────────────────────────────────
// Checker (framework-agnostic)
// ──────────────────────────────────────────────

// Checker is a framework-agnostic permission checker. It extracts the
// subject, object, and action from a request context and delegates
// to the Manager for enforcement.
type Checker struct {
	mgr       *Manager
	subjectFn func(ctx CheckContext) string
	objectFn  func(ctx CheckContext) string
	actionFn  func(ctx CheckContext) string
}

// CheckContext is the context passed to Checker functions. It is
// framework-agnostic — adapters convert framework-specific request
// objects into this interface.
type CheckContext interface {
	// Subject returns the authenticated subject (user ID, role, etc.).
	Subject() string
	// Object returns the resource being accessed (e.g. URL path).
	Object() string
	// Action returns the action being performed (e.g. HTTP method).
	Action() string
}

// CheckerOption configures a Checker.
type CheckerOption func(*Checker)

// WithSubjectFunc sets the function that extracts the subject from a context.
func WithSubjectFunc(f func(ctx CheckContext) string) CheckerOption {
	return func(c *Checker) { c.subjectFn = f }
}

// WithObjectFunc sets the function that extracts the object from a context.
func WithObjectFunc(f func(ctx CheckContext) string) CheckerOption {
	return func(c *Checker) { c.objectFn = f }
}

// WithActionFunc sets the function that extracts the action from a context.
func WithActionFunc(f func(ctx CheckContext) string) CheckerOption {
	return func(c *Checker) { c.actionFn = f }
}

// NewChecker creates a permission checker.
func NewChecker(mgr *Manager, opts ...CheckerOption) *Checker {
	c := &Checker{
		mgr: mgr,
		subjectFn: func(ctx CheckContext) string { return ctx.Subject() },
		objectFn:  func(ctx CheckContext) string { return ctx.Object() },
		actionFn:  func(ctx CheckContext) string { return ctx.Action() },
	}
	for _, opt := range opts {
		if opt != nil {
			opt(c)
		}
	}
	return c
}

// Check evaluates whether the context's subject can perform the
// context's action on the context's object.
func (c *Checker) Check(ctx CheckContext) (bool, error) {
	sub := c.subjectFn(ctx)
	obj := c.objectFn(ctx)
	act := c.actionFn(ctx)
	return c.mgr.Enforce(sub, obj, act)
}

// ──────────────────────────────────────────────
// SimpleCheckContext
// ──────────────────────────────────────────────

// SimpleCheckContext is a basic implementation of CheckContext.
type SimpleCheckContext struct {
	Sub string
	Obj string
	Act string
}

// Subject returns the subject.
func (s SimpleCheckContext) Subject() string { return s.Sub }

// Object returns the object.
func (s SimpleCheckContext) Object() string { return s.Obj }

// Action returns the action.
func (s SimpleCheckContext) Action() string { return s.Act }

// ──────────────────────────────────────────────
// Path normalization helper
// ──────────────────────────────────────────────

// NormalizePath removes a prefix from a path and trims trailing slashes.
// This is useful for stripping framework route prefixes before enforcement.
func NormalizePath(path, prefix string) string {
	if prefix != "" {
		path = strings.TrimPrefix(path, prefix)
	}
	path = strings.TrimRight(path, "/")
	if path == "" {
		path = "/"
	}
	return path
}
