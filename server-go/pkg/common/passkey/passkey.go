// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package passkey provides a thin wrapper around the go-webauthn library that
// implements the WebAuthn / Passkey server-side ceremony (registration and
// authentication) for passwordless authentication.
//
// WebAuthn is a W3C standard for public-key-based authentication. A "passkey"
// is a discoverable WebAuthn credential that allows login without a username
// (the authenticator returns the user handle). This package supports both
// username-based login and discoverable (usernameless) login.
//
// # Architecture
//
// The package is a stateless façade over [github.com/go-webauthn/webauthn].
// The caller is responsible for two pieces of persistent state:
//
//   - Credential storage: mapping user handles → registered credentials.
//     Implement the [CredentialStore] interface.
//   - Session storage: ephemeral storage for the challenge between the Begin
//     and Finish steps of a ceremony. Implement the [SessionStore] interface.
//
// This separation lets the package work with any backing store (memory, Redis,
// SQL, etc.) without coupling to a specific database driver.
//
// # Quick start (registration)
//
//	wa, err := passkey.New(passkey.Config{
//	    RPID:          "example.com",
//	    RPDisplayName: "My App",
//	    RPOrigins:     []string{"https://example.com"},
//	})
//	if err != nil { return err }
//
//	user := &myUser{id: []byte("user-123"), name: "alice"}
//	cred, session, err := wa.BeginRegistration(user, nil)
//	if err != nil { return err }
//	// Send `cred` (JSON) to the browser; persist `session` (JSON) keyed by
//	// a session ID, e.g. in a signed cookie.
//
//	// On the callback POST:
//	storedSession := sessionStore.Get(sessionID)
//	newCred, err := wa.FinishRegistration(user, storedSession, r)
//	if err != nil { return err }
//	credentialStore.Save(user.WebAuthnID(), newCred)
//
// # Quick start (discoverable login — usernameless)
//
//	assertion, session, err := wa.BeginDiscoverableLogin(nil)
//	// Send `assertion` to the browser; persist `session`.
//
//	user, cred, err := wa.FinishDiscoverableLogin(
//	    userHandler,  // looks up a user by their WebAuthnID
//	    storedSession,
//	    r,
//	)
package passkey

import (
	"errors"
	"net/http"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrInvalidConfig is returned when the WebAuthn config is missing required fields.
	ErrInvalidConfig = errors.New("passkey: invalid config: RPID, RPDisplayName, and RPOrigins are required")
	// ErrUserNotFound is returned by a DiscoverableUserHandler when no user
	// matches the given handle.
	ErrUserNotFound = errors.New("passkey: user not found")
	// ErrSessionExpired is returned when a ceremony session has expired.
	ErrSessionExpired = errors.New("passkey: session expired")
	// ErrNoCredentials is returned when a user has no registered credentials.
	ErrNoCredentials = errors.New("passkey: user has no registered credentials")
)

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

// Config configures the WebAuthn Relying Party.
type Config struct {
	// RPID is the Relying Party ID — typically the domain name without scheme
	// or port (e.g. "example.com"). Required.
	RPID string
	// RPDisplayName is a human-readable name shown by the authenticator
	// (e.g. "My App"). Required.
	RPDisplayName string
	// RPOrigins is the list of permitted origins (e.g. ["https://example.com"]).
	// At least one is required.
	RPOrigins []string
	// RPTopOrigins is an optional list of permitted top origins for
	// cross-origin ceremonies. Leave empty for same-origin deployments.
	RPTopOrigins []string
	// Timeout is the ceremony timeout in milliseconds. 0 uses the library
	// default (60000 for registration, 300000 for login).
	Timeout int
	// Debug enables verbose logging from the underlying library.
	Debug bool
}

// ──────────────────────────────────────────────
// User interface
// ──────────────────────────────────────────────

// User is the interface a user entity must satisfy to participate in WebAuthn
// ceremonies. It mirrors [webauthn.User] but is re-declared here so consumers
// don't need to import the underlying library directly.
type User interface {
	// WebAuthnID returns the user handle — an opaque byte sequence (max 64
	// bytes) that uniquely identifies the user. It MUST NOT be displayed to
	// the user and SHOULD be stable across the user's lifetime.
	WebAuthnID() []byte
	// WebAuthnName returns the username displayed by the authenticator
	// (e.g. "alice@example.com"). For discoverable credentials this is stored
	// on the authenticator.
	WebAuthnName() string
	// WebAuthnDisplayName returns a friendly name shown by the authenticator
	// (e.g. "Alice Smith"). May be the same as WebAuthnName.
	WebAuthnDisplayName() string
	// WebAuthnCredentials returns the user's registered credentials. For
	// registration this is typically empty; for login it must include the
	// credential being used.
	WebAuthnCredentials() []Credential
	// WebAuthnIcon is an optional avatar URL shown by some authenticators.
	// Return "" to omit.
	WebAuthnIcon() string
}

// Credential wraps a registered WebAuthn credential. It mirrors
// [webauthn.Credential] but is re-declared for a clean public API.
type Credential = webauthn.Credential

// ──────────────────────────────────────────────
// Session
// ──────────────────────────────────────────────

// SessionData is the ephemeral state that must be persisted between the Begin
// and Finish steps of a ceremony. It is JSON-serializable.
type SessionData = webauthn.SessionData

// ──────────────────────────────────────────────
// DiscoverableUserHandler
// ──────────────────────────────────────────────

// DiscoverableUserHandler looks up a user by their WebAuthnID (user handle)
// during a discoverable (usernameless) login. Return ErrUserNotFound if no
// user matches.
type DiscoverableUserHandler func(rawID, userHandle []byte) (User, error)

// ──────────────────────────────────────────────
// Registration options
// ──────────────────────────────────────────────

// RegistrationOptions configures the registration ceremony.
type RegistrationOptions struct {
	// SessionTimeout is the session expiry duration. 0 uses the library default.
	SessionTimeout int
	// ExcludeCredentials is a list of existing credential IDs that the new
	// credential must not duplicate (prevents re-registering the same device).
	ExcludeCredentials [][]byte
	// RequireResidentKey forces the credential to be a discoverable (client-side
	// discoverable) credential. Defaults to true for passkey flows.
	RequireResidentKey bool
	// UserVerification specifies the desired user verification level.
	// Defaults to protocol.VerificationRequired.
	UserVerification protocol.UserVerificationRequirement
	// AttestationPreference specifies the attestation conveyance preference.
	// Defaults to protocol.PreferDirectAttestation.
	AttestationPreference protocol.ConveyancePreference
}

// LoginOptions configures the login ceremony.
type LoginOptions struct {
	// SessionTimeout is the session expiry duration. 0 uses the library default.
	SessionTimeout int
	// UserVerification specifies the desired user verification level.
	// Defaults to protocol.VerificationRequired.
	UserVerification protocol.UserVerificationRequirement
}

// ──────────────────────────────────────────────
// WebAuthn wrapper
// ──────────────────────────────────────────────

// Passkey wraps a [webauthn.WebAuthn] instance and provides a simplified API
// for registration and login ceremonies.
type Passkey struct {
	wa *webauthn.WebAuthn
}

// New creates a new Passkey instance from the given config.
func New(cfg Config) (*Passkey, error) {
	if cfg.RPID == "" || cfg.RPDisplayName == "" || len(cfg.RPOrigins) == 0 {
		return nil, ErrInvalidConfig
	}
	wcfg := &webauthn.Config{
		RPID:          cfg.RPID,
		RPDisplayName: cfg.RPDisplayName,
		RPOrigins:     cfg.RPOrigins,
		RPTopOrigins:  cfg.RPTopOrigins,
		Debug:         cfg.Debug,
	}
	wa, err := webauthn.New(wcfg)
	if err != nil {
		return nil, err
	}
	return &Passkey{wa: wa}, nil
}

// ──────────────────────────────────────────────
// Registration
// ──────────────────────────────────────────────

// BeginRegistration starts a credential registration ceremony.
// Returns the credential creation options (to be sent to the browser as JSON)
// and session data (to be persisted server-side and passed to FinishRegistration).
func (p *Passkey) BeginRegistration(user User, opts *RegistrationOptions) (*protocol.CredentialCreation, *SessionData, error) {
	if user == nil {
		return nil, nil, ErrUserNotFound
	}
	regOpts := buildRegistrationOpts(opts)
	return p.wa.BeginRegistration(adaptUser(user), regOpts...)
}

// FinishRegistration completes a credential registration ceremony.
// Pass the session data from BeginRegistration and the HTTP request containing
// the authenticator's response (parsed from the browser's POST body).
// Returns the newly created credential on success.
func (p *Passkey) FinishRegistration(user User, session *SessionData, r *http.Request) (*Credential, error) {
	if user == nil {
		return nil, ErrUserNotFound
	}
	if session == nil {
		return nil, ErrSessionExpired
	}
	return p.wa.FinishRegistration(adaptUser(user), *session, r)
}

// ──────────────────────────────────────────────
// Login (username-based, multi-factor)
// ──────────────────────────────────────────────

// BeginLogin starts a username-based login ceremony. The user must already
// have at least one registered credential. Returns the credential assertion
// (to be sent to the browser) and session data (to be persisted).
func (p *Passkey) BeginLogin(user User, opts *LoginOptions) (*protocol.CredentialAssertion, *SessionData, error) {
	if user == nil {
		return nil, nil, ErrUserNotFound
	}
	if len(user.WebAuthnCredentials()) == 0 {
		return nil, nil, ErrNoCredentials
	}
	loginOpts := buildLoginOpts(opts)
	return p.wa.BeginLogin(adaptUser(user), loginOpts...)
}

// FinishLogin completes a username-based login ceremony.
func (p *Passkey) FinishLogin(user User, session *SessionData, r *http.Request) (*Credential, error) {
	if user == nil {
		return nil, ErrUserNotFound
	}
	if session == nil {
		return nil, ErrSessionExpired
	}
	return p.wa.FinishLogin(adaptUser(user), *session, r)
}

// ──────────────────────────────────────────────
// Discoverable login (usernameless / passkey)
// ──────────────────────────────────────────────

// BeginDiscoverableLogin starts a discoverable (usernameless) login ceremony.
// The authenticator returns the user handle, which is then looked up via the
// DiscoverableUserHandler in FinishDiscoverableLogin. Returns the credential
// assertion and session data.
func (p *Passkey) BeginDiscoverableLogin(opts *LoginOptions) (*protocol.CredentialAssertion, *SessionData, error) {
	loginOpts := buildLoginOpts(opts)
	return p.wa.BeginDiscoverableLogin(loginOpts...)
}

// FinishDiscoverableLogin completes a discoverable login ceremony. The handler
// is called with the user handle from the authenticator response and must
// return the corresponding user (or ErrUserNotFound).
func (p *Passkey) FinishDiscoverableLogin(handler DiscoverableUserHandler, session *SessionData, r *http.Request) (User, *Credential, error) {
	if handler == nil {
		return nil, nil, ErrUserNotFound
	}
	if session == nil {
		return nil, nil, ErrSessionExpired
	}
	var matchedUser User
	waHandler := func(rawID, userHandle []byte) (webauthn.User, error) {
		u, err := handler(rawID, userHandle)
		if err != nil {
			return nil, err
		}
		matchedUser = u
		return adaptUser(u), nil
	}
	waUser, cred, err := p.wa.FinishPasskeyLogin(waHandler, *session, r)
	if err != nil {
		return nil, nil, err
	}
	_ = waUser // matchedUser is set by the handler
	return matchedUser, cred, nil
}

// ──────────────────────────────────────────────
// Internal: user adapter
// ──────────────────────────────────────────────

// userAdapter wraps a passkey.User to satisfy webauthn.User.
type userAdapter struct {
	u User
}

func adaptUser(u User) webauthn.User {
	return &userAdapter{u: u}
}

func (a *userAdapter) WebAuthnID() []byte                          { return a.u.WebAuthnID() }
func (a *userAdapter) WebAuthnName() string                        { return a.u.WebAuthnName() }
func (a *userAdapter) WebAuthnDisplayName() string                 { return a.u.WebAuthnDisplayName() }
func (a *userAdapter) WebAuthnIcon() string                        { return a.u.WebAuthnIcon() }
func (a *userAdapter) WebAuthnCredentials() []webauthn.Credential  { return a.u.WebAuthnCredentials() }

// ──────────────────────────────────────────────
// Internal: options builders
// ──────────────────────────────────────────────

func buildRegistrationOpts(opts *RegistrationOptions) []webauthn.RegistrationOption {
	var regOpts []webauthn.RegistrationOption
	if opts == nil {
		return regOpts
	}
	if len(opts.ExcludeCredentials) > 0 {
		excl := make([]protocol.CredentialDescriptor, 0, len(opts.ExcludeCredentials))
		for _, id := range opts.ExcludeCredentials {
			excl = append(excl, protocol.CredentialDescriptor{
				Type:         protocol.PublicKeyCredentialType,
				CredentialID: id,
			})
		}
		regOpts = append(regOpts, webauthn.WithExclusions(excl))
	}
	if opts.UserVerification != "" || opts.RequireResidentKey {
		authSel := protocol.AuthenticatorSelection{}
		if opts.UserVerification != "" {
			authSel.UserVerification = opts.UserVerification
		}
		if opts.RequireResidentKey {
			authSel.ResidentKey = protocol.ResidentKeyRequirementRequired
			t := true
			authSel.RequireResidentKey = &t
		}
		regOpts = append(regOpts, webauthn.WithAuthenticatorSelection(authSel))
	}
	if opts.AttestationPreference != "" {
		regOpts = append(regOpts, webauthn.WithConveyancePreference(opts.AttestationPreference))
	}
	return regOpts
}

func buildLoginOpts(opts *LoginOptions) []webauthn.LoginOption {
	var loginOpts []webauthn.LoginOption
	if opts == nil {
		return loginOpts
	}
	if opts.UserVerification != "" {
		loginOpts = append(loginOpts, webauthn.WithUserVerification(opts.UserVerification))
	}
	return loginOpts
}
