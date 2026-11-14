// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package email

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ──────────────────────────────────────────────
// SendCloud delivery-status reader
// ──────────────────────────────────────────────
//
// SendCloud is a sending-only ESP; it does not host an inbox you can
// poll for inbound mail. It does, however, expose an emailStatus API
// that returns the delivery status of messages you previously sent.
// This implementation wraps that API so applications can "read back"
// the delivery state of their outbound SendCloud mail.
//
// API reference: https://www.sendcloud.net/doc/email_v2/deliver_response/

// SendCloudStatusQuery holds the filters for a SendCloud emailStatus
// query. Either Days or (StartDate + EndDate) must be set; the query
// window cannot exceed 3 days.
type SendCloudStatusQuery struct {
	Email       string   // filter by recipient address
	EmailIDs    []string // filter by SendCloud email IDs (joined with ';')
	LabelID     string
	LabelName   string
	APIUserList []string // multiple apiUser filter (joined with ';')
	Days        int      // shortcut for "past N days" (1 = today); max 3
	StartDate   string   // yyyy-MM-dd; required if Days == 0
	EndDate     string   // yyyy-MM-dd; required if Days == 0
	Start       int      // offset, default 0
	Limit       int      // 0-100, default 100
	Status      string   // "1" delivered, "4" invalid, "5" soft-bounce, "18" requested
	SubStatus   string   // e.g. "401;406"
}

// SendCloudDeliveryRecord is a single delivery-status entry returned
// by the SendCloud emailStatus API.
type SendCloudDeliveryRecord struct {
	EmailID       string `json:"emailId"`
	Status        string `json:"status"`
	SubStatus     string `json:"subStatus"`
	SubStatusDesc string `json:"subStatusDesc"`
	APIUser       string `json:"apiUser"`
	Recipients    string `json:"recipients"`
	RequestTime   string `json:"requestTime"`
	ModifiedTime  string `json:"modifiedTime"`
	SendLog       string `json:"sendLog"`
}

// ParsedRequestTime returns the parsed request time, or zero on error.
func (r SendCloudDeliveryRecord) ParsedRequestTime() time.Time {
	t, _ := time.ParseInLocation("2006-01-02 15:04:05", r.RequestTime, time.Local)
	return t
}

// ParsedModifiedTime returns the parsed modified time, or zero on error.
func (r SendCloudDeliveryRecord) ParsedModifiedTime() time.Time {
	t, _ := time.ParseInLocation("2006-01-02 15:04:05", r.ModifiedTime, time.Local)
	return t
}

// sendCloudStatusResponse is the raw API response envelope.
type sendCloudStatusResponse struct {
	Result     bool   `json:"result"`
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message"`
	Info       struct {
		Total      string                    `json:"total"`
		VoListSize int                       `json:"voListSize"`
		VoList     []SendCloudDeliveryRecord `json:"voList"`
	} `json:"info"`
}

// SendCloudReader queries the SendCloud emailStatus API for delivery
// records of previously-sent messages. It implements MailReader by
// mapping delivery records onto MailMessage structs (body is not
// available — only status metadata).
type SendCloudReader struct {
	cfg      SendCloudConfig
	client   *http.Client
	endpoint string
}

// NewSendCloudReader constructs a SendCloudReader from the given config.
// The API user/key must be set; From is not required for status queries.
func NewSendCloudReader(cfg SendCloudConfig) (*SendCloudReader, error) {
	if strings.TrimSpace(cfg.APIUser) == "" || strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("email: sendcloud api_user and api_key are required")
	}
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		endpoint = "https://api.sendcloud.net/apiv2/data/emailStatus"
	} else if !strings.Contains(endpoint, "emailStatus") {
		// Allow Endpoint override that points at the send endpoint; if
		// it doesn't look like the status endpoint, swap it.
		endpoint = "https://api.sendcloud.net/apiv2/data/emailStatus"
	}
	return &SendCloudReader{
		cfg:      cfg,
		client:   &http.Client{Timeout: 30 * time.Second},
		endpoint: endpoint,
	}, nil
}

// Kind returns "sendcloud".
func (r *SendCloudReader) Kind() string { return "sendcloud" }

// QueryStatus fetches delivery-status records matching the given query.
// Returns the records plus the total count reported by the API.
func (r *SendCloudReader) QueryStatus(q SendCloudStatusQuery) ([]SendCloudDeliveryRecord, int, error) {
	data := url.Values{}
	data.Set("apiUser", r.cfg.APIUser)
	data.Set("apiKey", r.cfg.APIKey)

	if strings.TrimSpace(q.Email) != "" {
		data.Set("email", q.Email)
	}
	if len(q.EmailIDs) > 0 {
		data.Set("emailIds", strings.Join(q.EmailIDs, ";"))
	}
	if strings.TrimSpace(q.LabelID) != "" {
		data.Set("labelId", q.LabelID)
	}
	if strings.TrimSpace(q.LabelName) != "" {
		data.Set("labelName", q.LabelName)
	}
	if len(q.APIUserList) > 0 {
		data.Set("apiUserList", strings.Join(q.APIUserList, ";"))
	}
	if q.Days > 0 {
		data.Set("days", strconv.Itoa(q.Days))
	} else if q.StartDate != "" || q.EndDate != "" {
		data.Set("startDate", q.StartDate)
		data.Set("endDate", q.EndDate)
	} else {
		// Default to today if neither Days nor date range is provided.
		data.Set("days", "1")
	}
	if q.Start > 0 {
		data.Set("start", strconv.Itoa(q.Start))
	}
	if q.Limit > 0 {
		data.Set("limit", strconv.Itoa(q.Limit))
	}
	if strings.TrimSpace(q.Status) != "" {
		data.Set("status", q.Status)
	}
	if strings.TrimSpace(q.SubStatus) != "" {
		data.Set("subStatus", q.SubStatus)
	}

	req, err := http.NewRequest(http.MethodPost, r.endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, 0, fmt.Errorf("sendcloud: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("sendcloud: request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, 0, fmt.Errorf("sendcloud: read body: %w", err)
	}

	var result sendCloudStatusResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, 0, fmt.Errorf("sendcloud: parse response: %w", err)
	}

	if resp.StatusCode/100 != 2 {
		msg := strings.TrimSpace(result.Message)
		if msg == "" {
			msg = strings.TrimSpace(string(body))
		}
		if msg == "" {
			msg = resp.Status
		}
		return nil, 0, fmt.Errorf("sendcloud: http %d: %s", resp.StatusCode, msg)
	}
	if !result.Result {
		msg := strings.TrimSpace(result.Message)
		if msg == "" {
			msg = "request failed"
		}
		return nil, 0, fmt.Errorf("sendcloud: %s", msg)
	}

	total, _ := strconv.Atoi(result.Info.Total)
	return result.Info.VoList, total, nil
}

// ──────────────────────────────────────────────
// MailReader interface conformance
// ──────────────────────────────────────────────
//
// SendCloud has no true inbox, so ReadMessages maps the most recent
// delivery records onto MailMessage structs. The body fields are empty
// (SendCloud does not return message content via this API); ID, From,
// To, Subject, and Date are populated from the delivery metadata.

// ReadMessages fetches up to `limit` recent delivery records and maps
// them onto MailMessage. The From field is set to the configured sender.
func (r *SendCloudReader) ReadMessages(limit int) ([]*MailMessage, error) {
	q := SendCloudStatusQuery{Days: 3}
	if limit > 0 {
		if limit > 100 {
			limit = 100
		}
		q.Limit = limit
	}

	records, _, err := r.QueryStatus(q)
	if err != nil {
		return nil, err
	}

	fromName, fromAddr, _ := ParseSender(r.cfg.From, r.cfg.FromName)

	msgs := make([]*MailMessage, 0, len(records))
	for _, rec := range records {
		msg := &MailMessage{
			ID:      rec.EmailID,
			From:    fromAddr,
			To:      []string{rec.Recipients},
			Subject: fmt.Sprintf("[SendCloud] %s", rec.Status),
			Date:    rec.ParsedRequestTime(),
		}
		if fromName != "" {
			msg.FromName = fromName
		}
		// Store delivery metadata in TextBody for visibility.
		msg.TextBody = fmt.Sprintf(
			"emailId=%s\nstatus=%s\nsubStatus=%s\nsubStatusDesc=%s\nrecipient=%s\nrequestTime=%s\nmodifiedTime=%s\nsendLog=%s",
			rec.EmailID, rec.Status, rec.SubStatus, rec.SubStatusDesc,
			rec.Recipients, rec.RequestTime, rec.ModifiedTime, rec.SendLog,
		)
		msgs = append(msgs, msg)
	}
	return msgs, nil
}

// MarkRead is a no-op for SendCloud (delivery records are read-only).
func (r *SendCloudReader) MarkRead(id string) error { return nil }

// DeleteMessage is a no-op for SendCloud (delivery records cannot be
// deleted via this API).
func (r *SendCloudReader) DeleteMessage(id string) error { return nil }

// Close releases the HTTP client. No persistent connection to maintain.
func (r *SendCloudReader) Close() error { return nil }

// ──────────────────────────────────────────────
// SendCloud status → MailLog status mapping
// ──────────────────────────────────────────────

// SendCloudStatusToMailStatus maps a SendCloud delivery status string
// (e.g. "送达", "无效邮件-地址不存在", "软退信-服务不可达") to a
// normalized mail log status.
func SendCloudStatusToMailStatus(status string) string {
	s := strings.TrimSpace(status)
	switch {
	case s == "" || s == "请求中":
		return StatusSent
	case strings.HasPrefix(s, "送达"):
		return StatusDelivered
	case strings.HasPrefix(s, "无效邮件"):
		return StatusFailed
	case strings.HasPrefix(s, "软退信"):
		return StatusSoftBounce
	default:
		return StatusUnknown
	}
}
