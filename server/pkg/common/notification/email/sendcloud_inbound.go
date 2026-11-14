// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package email

import (
	"crypto/md5"
	"encoding/hex"
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
// SendCloud inbound (route) webhook event
// ──────────────────────────────────────────────
//
// When a recipient replies to an email you sent via SendCloud, and you
// have configured an inbound route (收信路由) pointing to a webhook URL,
// SendCloud POSTs the reply content to that URL. This is SendCloud's
// equivalent of "receiving" email — there is no inbox to poll.
//
// The route webhook payload is richer than a delivery event: it
// includes the full reply message (raw_message, html, text, subject,
// from, to, headers, attachments reference, etc.).
//
// API reference: https://www.sendcloud.net/doc/guide/advance/

// SendCloudInboundEvent is a parsed inbound (route) webhook payload
// from SendCloud, representing a reply email forwarded by a 收信路由.
type SendCloudInboundEvent struct {
	Event         string `json:"event"`           // "route"
	Message       string `json:"message"`         // "mx route"
	Timestamp     int64  `json:"timestamp"`       // unix timestamp
	From          string `json:"from"`            // header From address
	FromName      string `json:"fromname"`        // From display name
	To            string `json:"to"`              // header To address
	ToName        string `json:"toname"`          // To display name
	XMXMailFrom   string `json:"x_mx_mailfrom"`   // envelope sender
	XMXRcptTo     string `json:"x_mx_rcptto"`     // envelope recipient
	Headers       string `json:"headers"`         // raw headers (JSON)
	HTML          string `json:"html"`            // html body
	Text          string `json:"text"`            // text body
	Subject       string `json:"subject"`         // subject
	RawMessageURL string `json:"raw_message_url"` // .eml download URL (15-day TTL)
	RawMessage    string `json:"raw_message"`     // raw RFC 822 message
	Token         string `json:"token"`           // random 50-char string
	Signature     string `json:"signature"`       // signature string
	UserHeaders   string `json:"userHeaders"`     // custom SC-Custom-* headers
	Reference     string `json:"reference"`       // original SendCloud Message-ID
	EmailID       string `json:"emailId"`         // parent email ID
	LabelID       int    `json:"labelId"`         // parent label ID
	LabelName     string `json:"labelName"`       // parent label name
}

// ToMailMessage converts an inbound event into a MailMessage. If
// RawMessage is present it is parsed for full body/attachment
// extraction; otherwise the HTML/Text fields are used directly.
func (e *SendCloudInboundEvent) ToMailMessage() (*MailMessage, error) {
	msg := &MailMessage{
		ID:       e.Reference,
		From:     e.From,
		FromName: e.FromName,
		Subject:  e.Subject,
		HTMLBody: e.HTML,
		TextBody: e.Text,
		ReplyTo:  "",
	}
	if e.To != "" {
		msg.To = []string{e.To}
	}
	if e.Timestamp > 0 {
		msg.Date = time.Unix(e.Timestamp, 0)
	}

	// If we have a raw RFC 822 message, parse it for richer content.
	if strings.TrimSpace(e.RawMessage) != "" {
		if parsed, err := ParseMailMessage([]byte(e.RawMessage)); err == nil {
			// Raw message takes priority for body/attachments.
			if parsed.TextBody != "" {
				msg.TextBody = parsed.TextBody
			}
			if parsed.HTMLBody != "" {
				msg.HTMLBody = parsed.HTMLBody
			}
			msg.Attachments = parsed.Attachments
			msg.Cc = parsed.Cc
			msg.Headers = parsed.Headers
			if parsed.ID != "" {
				msg.ID = parsed.ID
			}
			if parsed.ReplyTo != "" {
				msg.ReplyTo = parsed.ReplyTo
			}
			if !parsed.Date.IsZero() {
				msg.Date = parsed.Date
			}
		}
	}

	return msg, nil
}

// ParseSendCloudInboundEvent parses a JSON or x-www-form-urlencoded
// SendCloud route webhook body into an inbound event.
func ParseSendCloudInboundEvent(data []byte) (*SendCloudInboundEvent, error) {
	// Try JSON first.
	var event SendCloudInboundEvent
	if err := json.Unmarshal(data, &event); err == nil && event.Event == "route" {
		return &event, nil
	}

	// Fall back to form-encoded parsing (SendCloud often posts as
	// application/x-www-form-urlencoded).
	params, err := url.ParseQuery(string(data))
	if err != nil {
		return nil, fmt.Errorf("sendcloud inbound: parse form: %w", err)
	}

	event = SendCloudInboundEvent{
		Event:         params.Get("event"),
		Message:       params.Get("message"),
		From:          params.Get("from"),
		FromName:      params.Get("fromname"),
		To:            params.Get("to"),
		ToName:        params.Get("toname"),
		XMXMailFrom:   params.Get("x_mx_mailfrom"),
		XMXRcptTo:     params.Get("x_mx_rcptto"),
		Headers:       params.Get("headers"),
		HTML:          params.Get("html"),
		Text:          params.Get("text"),
		Subject:       params.Get("subject"),
		RawMessageURL: params.Get("raw_message_url"),
		RawMessage:    params.Get("raw_message"),
		Token:         params.Get("token"),
		Signature:     params.Get("signature"),
		UserHeaders:   params.Get("userHeaders"),
		Reference:     params.Get("reference"),
		EmailID:       params.Get("emailId"),
		LabelName:     params.Get("labelName"),
	}
	if id := params.Get("labelId"); id != "" {
		if n, err := strconv.Atoi(id); err == nil {
			event.LabelID = n
		}
	}
	if ts := params.Get("timestamp"); ts != "" {
		if n, err := strconv.ParseInt(ts, 10, 64); err == nil {
			event.Timestamp = n
		}
	}
	return &event, nil
}

// VerifySendCloudInboundSignature verifies the signature of an inbound
// webhook event. SendCloud computes the signature as
// MD5(token + api_key) and sends it in the `signature` field.
// Pass your API key to verify.
func VerifySendCloudInboundSignature(event *SendCloudInboundEvent, apiKey string) bool {
	if event == nil || event.Signature == "" || event.Token == "" {
		return false
	}
	expected := md5Hex(event.Token + apiKey)
	return strings.EqualFold(expected, event.Signature)
}

// ──────────────────────────────────────────────
// SendCloud inbound route management API
// ──────────────────────────────────────────────

// SendCloudRoute is an inbound route configuration entry.
type SendCloudRoute struct {
	ID           int    `json:"id"`
	Domain       string `json:"domain"`
	Expression   string `json:"expression"`   // e.g. "reply@yourdomain.com" or ".*@yourdomain.com"
	Action       string `json:"action"`       // "URL" or "邮箱"
	APIUserRoute string `json:"apiUserRoute"` // required when action is email
}

// sendCloudRouteListResponse is the API response for route/list.
// The API may return routes under either "dataList" or "voList"
// depending on the version, so both are parsed.
type sendCloudRouteListResponse struct {
	Result     bool   `json:"result"`
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message"`
	Info       struct {
		Total    int              `json:"total"`
		Count    int              `json:"count"`
		DataList []SendCloudRoute `json:"dataList"`
		VoList   []SendCloudRoute `json:"voList"`
	} `json:"info"`
}

// sendCloudRouteAddResponse is the API response for route/add.
type sendCloudRouteAddResponse struct {
	Result     bool   `json:"result"`
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message"`
	Info       struct {
		ID int `json:"id"`
	} `json:"info"`
}

// ListInboundRoutes queries existing inbound routes.
func (r *SendCloudReader) ListInboundRoutes(domain string, start, limit int) ([]SendCloudRoute, error) {
	data := url.Values{}
	data.Set("apiUser", r.cfg.APIUser)
	data.Set("apiKey", r.cfg.APIKey)
	if strings.TrimSpace(domain) != "" {
		data.Set("domain", domain)
	}
	if start > 0 {
		data.Set("start", strconv.Itoa(start))
	}
	if limit > 0 {
		data.Set("limit", strconv.Itoa(limit))
	}

	endpoint := r.routeEndpoint("list")

	respBody, err := r.doPost(endpoint, data)
	if err != nil {
		return nil, err
	}

	var result sendCloudRouteListResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("sendcloud: parse route list: %w", err)
	}
	if !result.Result {
		return nil, fmt.Errorf("sendcloud: %s", strings.TrimSpace(result.Message))
	}
	// Prefer dataList (current API), fall back to voList (older versions).
	if len(result.Info.DataList) > 0 {
		return result.Info.DataList, nil
	}
	return result.Info.VoList, nil
}

// AddInboundRoute creates a new inbound route.
// expression is the matching pattern, e.g. "contact@email.lingecho.com"
// or ".*@email.lingecho.com" (regex@domain).
// action is the destination — either a webhook URL (e.g.
// "https://yourapp.com/webhook/sendcloud") or an email address to
// forward to (e.g. "you@qq.com"). When action is an email address,
// apiUserRoute must be set to the API_USER used for forwarding.
func (r *SendCloudReader) AddInboundRoute(expression, action, apiUserRoute string) (int, error) {
	data := url.Values{}
	data.Set("apiUser", r.cfg.APIUser)
	data.Set("apiKey", r.cfg.APIKey)
	data.Set("expression", expression)
	data.Set("action", action)
	if strings.TrimSpace(apiUserRoute) != "" {
		data.Set("apiUserRoute", apiUserRoute)
	}

	endpoint := r.routeEndpoint("add")

	respBody, err := r.doPost(endpoint, data)
	if err != nil {
		return 0, err
	}

	var result sendCloudRouteAddResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return 0, fmt.Errorf("sendcloud: parse route add: %w", err)
	}
	if !result.Result {
		return 0, fmt.Errorf("sendcloud: %s", strings.TrimSpace(result.Message))
	}
	return result.Info.ID, nil
}

// DeleteInboundRoute removes an inbound route by ID.
func (r *SendCloudReader) DeleteInboundRoute(routeID int) error {
	data := url.Values{}
	data.Set("apiUser", r.cfg.APIUser)
	data.Set("apiKey", r.cfg.APIKey)
	data.Set("routeId", strconv.Itoa(routeID))

	endpoint := r.routeEndpoint("delete")

	respBody, err := r.doPost(endpoint, data)
	if err != nil {
		return err
	}

	var result sendCloudRouteListResponse // reuse shape; response has result/message
	if err := json.Unmarshal(respBody, &result); err != nil {
		return fmt.Errorf("sendcloud: parse route delete: %w", err)
	}
	if !result.Result {
		return fmt.Errorf("sendcloud: %s", strings.TrimSpace(result.Message))
	}
	return nil
}

// routeEndpoint derives the route API endpoint from the configured
// emailStatus endpoint. If the endpoint was overridden to a test server
// (no "sendcloud.net"), the path is appended to that server's URL.
func (r *SendCloudReader) routeEndpoint(action string) string {
	if strings.Contains(r.endpoint, "sendcloud.net") {
		return "https://api.sendcloud.net/apiv2/route/" + action
	}
	// Test server or custom endpoint: append the route path.
	return strings.TrimRight(r.endpoint, "/") + "/route/" + action
}

// doPost is the shared HTTP POST helper for SendCloud route APIs.
func (r *SendCloudReader) doPost(endpoint string, data url.Values) ([]byte, error) {
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("sendcloud: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sendcloud: request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("sendcloud: read body: %w", err)
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("sendcloud: http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}

// md5Hex returns the lowercase hex MD5 digest of s.
func md5Hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}
