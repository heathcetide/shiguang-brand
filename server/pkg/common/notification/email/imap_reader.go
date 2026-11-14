// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package email

import (
	"fmt"
	"strings"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

// ──────────────────────────────────────────────
// IMAP mail reader
// ──────────────────────────────────────────────

// IMAPConfig holds the connection settings for an IMAP server.
type IMAPConfig struct {
	Host     string // IMAP server host (e.g. "imap.qq.com")
	Port     int    // IMAP server port (typically 993 for TLS)
	Username string // account username (full email address)
	Password string // account password or authorization code
	Mailbox  string // mailbox name (default "INBOX")
}

// IMAPReader implements MailReader using the IMAP protocol.
// It connects via TLS, logs in, and fetches messages from the
// configured mailbox.
type IMAPReader struct {
	cfg    IMAPConfig
	client *imapclient.Client
}

// NewIMAPReader creates a new IMAPReader and establishes a connection
// to the IMAP server. The connection is ready for ReadMessages calls
// after construction. Call Close to release the connection.
func NewIMAPReader(cfg IMAPConfig) (*IMAPReader, error) {
	if strings.TrimSpace(cfg.Host) == "" {
		return nil, fmt.Errorf("email: IMAP host is required")
	}
	if cfg.Port == 0 {
		cfg.Port = 993
	}
	if strings.TrimSpace(cfg.Mailbox) == "" {
		cfg.Mailbox = "INBOX"
	}

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	client, err := imapclient.DialTLS(addr, nil)
	if err != nil {
		return nil, fmt.Errorf("email: IMAP connect %s: %w", addr, err)
	}

	if err := client.Login(cfg.Username, cfg.Password).Wait(); err != nil {
		client.Logout().Wait()
		return nil, fmt.Errorf("email: IMAP login: %w", err)
	}

	return &IMAPReader{cfg: cfg, client: client}, nil
}

// ReadMessages fetches up to limit unread (unseen) messages from the
// mailbox. If limit <= 0, all unread messages are fetched. Messages
// are returned newest-first.
func (r *IMAPReader) ReadMessages(limit int) ([]*MailMessage, error) {
	return r.readMessagesWithCriteria(limit, &imap.SearchCriteria{
		NotFlag: []imap.Flag{imap.FlagSeen},
	})
}

// ReadRecentMessages fetches up to limit most recent messages
// regardless of read state. If limit <= 0, all messages are fetched.
// Messages are returned newest-first.
func (r *IMAPReader) ReadRecentMessages(limit int) ([]*MailMessage, error) {
	return r.readMessagesWithCriteria(limit, &imap.SearchCriteria{})
}

// readMessagesWithCriteria is the shared implementation for ReadMessages
// and ReadRecentMessages.
func (r *IMAPReader) readMessagesWithCriteria(limit int, searchCriteria *imap.SearchCriteria) ([]*MailMessage, error) {
	if r.client == nil {
		return nil, fmt.Errorf("email: IMAP reader is closed")
	}

	mailbox := r.cfg.Mailbox
	_, err := r.client.Select(mailbox, nil).Wait()
	if err != nil {
		return nil, fmt.Errorf("email: IMAP select %q: %w", mailbox, err)
	}

	searchCmd := r.client.UIDSearch(searchCriteria, nil)
	searchResult, err := searchCmd.Wait()
	if err != nil {
		return nil, fmt.Errorf("email: IMAP search: %w", err)
	}

	uids := searchResult.AllUIDs()
	if len(uids) == 0 {
		return nil, nil
	}

	// Apply limit (newest first — UIDs are ascending, so take from end).
	if limit > 0 && len(uids) > limit {
		uids = uids[len(uids)-limit:]
	}

	// Build UID set for fetch.
	uidSet := imap.UIDSet{}
	for _, uid := range uids {
		uidSet.AddNum(uid)
	}

	// Fetch full message bodies.
	fetchOptions := &imap.FetchOptions{
		BodySection: []*imap.FetchItemBodySection{
			{Peek: true}, // Peek = don't mark as seen
		},
		Envelope:     true,
		InternalDate: true,
		RFC822Size:   true,
		UID:          true,
	}

	fetchCmd := r.client.Fetch(uidSet, fetchOptions)
	defer fetchCmd.Close()

	var messages []*MailMessage
	for {
		msgData := fetchCmd.Next()
		if msgData == nil {
			break
		}

		msg, err := convertIMAPFetchData(msgData)
		if err != nil {
			continue // skip unparseable messages
		}
		messages = append(messages, msg)
	}

	// Reverse to get newest-first order.
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, nil
}

// MarkRead marks a message as read by adding the \Seen flag.
// The message ID should be the UID from the fetched message.
func (r *IMAPReader) MarkRead(id string) error {
	if r.client == nil {
		return fmt.Errorf("email: IMAP reader is closed")
	}
	uid, err := parseUID(id)
	if err != nil {
		return fmt.Errorf("email: invalid UID %q: %w", id, err)
	}

	uidSet := imap.UIDSet{}
	uidSet.AddNum(uid)

	storeFlags := imap.StoreFlags{
		Op:    imap.StoreFlagsAdd,
		Flags: []imap.Flag{imap.FlagSeen},
	}
	fetchCmd := r.client.Store(uidSet, &storeFlags, nil)
	return fetchCmd.Close()
}

// DeleteMessage marks a message as deleted and expunges it.
// The message ID should be the UID.
func (r *IMAPReader) DeleteMessage(id string) error {
	if r.client == nil {
		return fmt.Errorf("email: IMAP reader is closed")
	}
	uid, err := parseUID(id)
	if err != nil {
		return fmt.Errorf("email: invalid UID %q: %w", id, err)
	}

	uidSet := imap.UIDSet{}
	uidSet.AddNum(uid)

	storeFlags := imap.StoreFlags{
		Op:    imap.StoreFlagsAdd,
		Flags: []imap.Flag{imap.FlagDeleted},
	}
	fetchCmd := r.client.Store(uidSet, &storeFlags, nil)
	if err := fetchCmd.Close(); err != nil {
		return fmt.Errorf("email: IMAP store: %w", err)
	}

	if err := r.client.Expunge().Close(); err != nil {
		return fmt.Errorf("email: IMAP expunge: %w", err)
	}
	return nil
}

// Close logs out and closes the IMAP connection.
func (r *IMAPReader) Close() error {
	if r.client == nil {
		return nil
	}
	err := r.client.Logout().Wait()
	r.client = nil
	return err
}

// ──────────────────────────────────────────────
// IMAP → MailMessage conversion
// ──────────────────────────────────────────────

// convertIMAPFetchData converts an IMAP fetch result into a MailMessage.
func convertIMAPFetchData(data *imapclient.FetchMessageData) (*MailMessage, error) {
	buf, err := data.Collect()
	if err != nil {
		return nil, fmt.Errorf("collect fetch data: %w", err)
	}

	msg := &MailMessage{
		ID: fmt.Sprintf("%d", buf.UID),
	}

	// Parse envelope.
	if buf.Envelope != nil {
		env := buf.Envelope
		if env.MessageID != "" {
			msg.ID = strings.TrimSpace(env.MessageID)
		}
		msg.Subject = decodeMimeHeader(env.Subject)
		msg.Date = env.Date

		if env.From != nil && len(env.From) > 0 {
			msg.From = env.From[0].Addr()
			msg.FromName = decodeMimeHeader(env.From[0].Name)
		}
		if env.To != nil {
			for _, addr := range env.To {
				if a := addr.Addr(); a != "" {
					msg.To = append(msg.To, a)
				}
			}
		}
		if env.Cc != nil {
			for _, addr := range env.Cc {
				if a := addr.Addr(); a != "" {
					msg.Cc = append(msg.Cc, a)
				}
			}
		}
		if env.ReplyTo != nil && len(env.ReplyTo) > 0 {
			msg.ReplyTo = env.ReplyTo[0].Addr()
		}
	}

	// Use UID as fallback ID if envelope has no Message-ID.
	if msg.ID == "" && buf.UID != 0 {
		msg.ID = fmt.Sprintf("%d", buf.UID)
	}

	// Parse body from the first body section.
	for _, section := range buf.BodySection {
		if len(section.Bytes) == 0 {
			continue
		}
		// Parse the raw RFC 822 message for body/attachments.
		parsed, err := ParseMailMessage(section.Bytes)
		if err != nil {
			// Fallback: store raw body as text.
			if msg.TextBody == "" {
				msg.TextBody = string(section.Bytes)
			}
			continue
		}
		// Merge parsed body/attachments (envelope data takes priority for headers).
		if parsed.TextBody != "" && msg.TextBody == "" {
			msg.TextBody = parsed.TextBody
		}
		if parsed.HTMLBody != "" && msg.HTMLBody == "" {
			msg.HTMLBody = parsed.HTMLBody
		}
		if len(parsed.Attachments) > 0 {
			msg.Attachments = append(msg.Attachments, parsed.Attachments...)
		}
		break // only need the first body section
	}

	return msg, nil
}

// parseUID parses a UID string into an imap.UID.
func parseUID(id string) (imap.UID, error) {
	var uid uint32
	for _, c := range id {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("non-numeric UID")
		}
		uid = uid*10 + uint32(c-'0')
	}
	if uid == 0 {
		return 0, fmt.Errorf("empty UID")
	}
	return imap.UID(uid), nil
}
