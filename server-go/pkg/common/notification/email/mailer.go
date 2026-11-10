// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package email

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/notification"
)

// MailerOption configures a Mailer at construction time.
type MailerOption func(*Mailer)

// WithRetryPolicy overrides the default retry policy.
func WithRetryPolicy(p RetryPolicy) MailerOption {
	return func(m *Mailer) {
		if p.MaxAttempts < 1 {
			p.MaxAttempts = 1
		}
		m.retryPolicy = p
	}
}

// WithStartingIndex sets the initial round-robin provider index.
func WithStartingIndex(i int) MailerOption {
	return func(m *Mailer) {
		m.startingIndex = i
	}
}

// Mailer is a multi-channel email sender with per-provider retry and
// cross-provider failover. Providers are selected round-robin starting
// at startingIndex, which advances after every successful send.
type Mailer struct {
	providers     []MailProvider
	retryPolicy   RetryPolicy
	startingIndex int
	mu            sync.Mutex
	currentIndex  int
}

// NewMailer creates a Mailer over the given providers. At least one
// provider is required; options may override the retry policy and
// starting index.
func NewMailer(providers []MailProvider, opts ...MailerOption) *Mailer {
	m := &Mailer{
		providers:   providers,
		retryPolicy: DefaultRetryPolicy(),
	}
	for _, opt := range opts {
		opt(m)
	}
	if len(providers) > 0 {
		m.currentIndex = m.startingIndex % len(providers)
	}
	return m
}

// Send delivers an HTML message. It tries providers in round-robin
// order; each provider is retried up to RetryPolicy.MaxAttempts with
// exponential backoff before failing over to the next provider.
func (m *Mailer) Send(ctx context.Context, to, subject, htmlBody string) error {
	return m.send(ctx, func(p MailProvider) (string, error) {
		return p.SendHTMLWith(to, subject, htmlBody, nil)
	})
}

// SendText delivers a plain-text message using the same retry/failover
// strategy as Send.
func (m *Mailer) SendText(ctx context.Context, to, subject, textBody string) error {
	return m.send(ctx, func(p MailProvider) (string, error) {
		return p.SendTextWith(to, subject, textBody, nil)
	})
}

// SendWithTemplate loads a template from the store, renders it with
// vars, and sends the result as HTML (falling back to text when the
// template body is not HTML).
func (m *Mailer) SendWithTemplate(ctx context.Context, to, subject, templateCode string, vars map[string]any, templateStore notification.TemplateStore) error {
	if templateStore == nil {
		return fmt.Errorf("email: template store is nil")
	}
	locale := ""
	if v, ok := vars["locale"]; ok {
		if l, ok := v.(string); ok {
			locale = l
		}
	}
	tplSubject, tplBody, err := templateStore.LoadTemplate(templateCode, locale)
	if err != nil {
		return fmt.Errorf("email: load template %q: %w", templateCode, err)
	}
	if subject == "" {
		subject = tplSubject
	}
	renderedBody := ReplacePlaceholders(tplBody, vars)
	renderedSubject := ReplacePlaceholders(subject, vars)

	return m.send(ctx, func(p MailProvider) (string, error) {
		return p.SendHTMLWith(to, renderedSubject, renderedBody, nil)
	})
}

// send runs the round-robin retry/failover loop against the provided
// send function.
func (m *Mailer) send(ctx context.Context, do func(MailProvider) (string, error)) error {
	if len(m.providers) == 0 {
		return fmt.Errorf("email: no providers configured")
	}

	start := m.nextIndex()
	n := len(m.providers)

	var lastErr error
	for i := 0; i < n; i++ {
		provider := m.providers[(start+i)%n]

		if err := ctx.Err(); err != nil {
			return err
		}

		if err := m.retryProvider(ctx, provider, do); err != nil {
			lastErr = err
			continue
		}

		// Success: advance the round-robin pointer past this provider.
		m.advanceIndex(start, i, n)
		return nil
	}
	return fmt.Errorf("email: all providers failed: %w", lastErr)
}

// retryProvider attempts to send through a single provider, retrying
// up to RetryPolicy.MaxAttempts with exponential backoff.
func (m *Mailer) retryProvider(ctx context.Context, p MailProvider, do func(MailProvider) (string, error)) error {
	var lastErr error
	backoff := m.retryPolicy.InitialBackoff
	if backoff <= 0 {
		backoff = 1 * time.Second
	}

	for attempt := 0; attempt < m.retryPolicy.MaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
			backoff = time.Duration(math.Min(float64(backoff*2), float64(m.retryPolicy.MaxBackoff)))
		}

		if _, err := do(p); err != nil {
			lastErr = err
			continue
		}
		return nil
	}
	return fmt.Errorf("provider %s: %w", p.Kind(), lastErr)
}

// nextIndex returns the current round-robin start index in a
// thread-safe way.
func (m *Mailer) nextIndex() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.currentIndex < 0 {
		m.currentIndex = 0
	}
	if len(m.providers) > 0 {
		m.currentIndex %= len(m.providers)
	}
	return m.currentIndex
}

// advanceIndex moves the round-robin pointer to the provider after the
// one that just succeeded.
func (m *Mailer) advanceIndex(start, offset, n int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.currentIndex = (start + offset + 1) % n
}
