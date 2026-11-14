// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package curlutil provides a curl command parser and a debug-oriented
// HTTP client with detailed response inspection.
//
// It is designed for building HTTP debugging tools (like a web-based
// curl playground) where you need:
//
//   - Parse a curl command string into a structured request
//   - Execute HTTP requests with full control over redirects, TLS, headers
//   - Inspect response details: redirect chain, TLS version, binary detection
//   - Generate hex previews for binary responses
//
// # Quick start
//
//	// Parse a curl command
//	req, err := curlutil.ParseCurlCommand(`curl -X POST https://httpbin.org/post -H "Content-Type: application/json" -d '{"key":"value"}'`)
//
//	// Execute with full debug info
//	resp, err := curlutil.Execute(req)
//	fmt.Printf("Status: %d, Time: %dms, TLS: %s\n", resp.StatusCode, resp.ResponseTime, resp.RequestInfo.TLSVersion)
//
//	// Simple GET
//	resp, err = curlutil.Get("https://example.com")
package curlutil

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/heathcetide/DietDigiDose/pkg/common/crypto"
)

// ─── Request / Response types ───────────────────────────────────

// Request represents an HTTP request with debug options.
type Request struct {
	URL            string            `json:"url"`
	Method         string            `json:"method"`
	Headers        map[string]string `json:"headers"`
	Body           string            `json:"body"`
	Timeout        int               `json:"timeout"`         // seconds
	FollowRedirect bool              `json:"follow_redirect"`
	VerifySSL      bool              `json:"verify_ssl"`
	HeadOnly       bool              `json:"head_only"`
}

// Response holds the full debug response from an HTTP request.
type Response struct {
	URL           string            `json:"url"`
	Method        string            `json:"method"`
	StatusCode    int               `json:"status_code"`
	StatusText    string            `json:"status_text"`
	Headers       map[string]string `json:"headers"`
	Body          string            `json:"body"`
	BodyPreview   string            `json:"body_preview"`
	BodySize      int64             `json:"body_size"`
	IsBinary      bool              `json:"is_binary"`
	ResponseTime  int64             `json:"response_time_ms"`
	ContentLength int64             `json:"content_length"`
	ContentType   string            `json:"content_type"`
	RedirectChain []string          `json:"redirect_chain,omitempty"`
	RequestInfo   RequestInfo       `json:"request_info"`
}

// RequestInfo holds metadata about the actual request sent.
type RequestInfo struct {
	FinalURL       string            `json:"final_url"`
	RemoteAddr     string            `json:"remote_addr"`
	Protocol       string            `json:"protocol"`
	TLSVersion     string            `json:"tls_version,omitempty"`
	RequestHeaders map[string]string `json:"request_headers"`
}

// ─── Defaults ───────────────────────────────────────────────────

const (
	DefaultTimeout   = 30
	DefaultUserAgent = "ling-base-curlutil/1.0"
	MaxBodyPreview   = 10000
	MaxRedirects     = 10
)

// ─── Package-level convenience functions ────────────────────────

// Get sends a simple GET request.
func Get(targetURL string) (*Response, error) {
	return Execute(&Request{
		URL:            targetURL,
		Method:         "GET",
		FollowRedirect: true,
		VerifySSL:      true,
		Timeout:        DefaultTimeout,
	})
}

// Post sends a simple POST request.
func Post(targetURL, body string) (*Response, error) {
	return Execute(&Request{
		URL:            targetURL,
		Method:         "POST",
		Body:           body,
		FollowRedirect: true,
		VerifySSL:      true,
		Timeout:        DefaultTimeout,
		Headers:        map[string]string{"Content-Type": "application/json"},
	})
}

// Head sends a HEAD request.
func Head(targetURL string) (*Response, error) {
	return Execute(&Request{
		URL:            targetURL,
		Method:         "HEAD",
		HeadOnly:       true,
		FollowRedirect: true,
		VerifySSL:      true,
		Timeout:        DefaultTimeout,
	})
}

// Execute sends an HTTP request and returns a detailed debug response.
func Execute(req *Request) (*Response, error) {
	if req == nil {
		return nil, fmt.Errorf("curlutil: request is nil")
	}
	return ExecuteContext(context.Background(), req)
}

// ExecuteContext sends an HTTP request with a custom context.
func ExecuteContext(ctx context.Context, req *Request) (*Response, error) {
	if req == nil {
		return nil, fmt.Errorf("curlutil: request is nil")
	}

	startTime := time.Now()

	// Validate and normalize URL
	parsedURL, err := url.Parse(req.URL)
	if err != nil {
		return nil, fmt.Errorf("curlutil: invalid URL: %w", err)
	}
	if parsedURL.Scheme == "" {
		req.URL = "https://" + req.URL
		parsedURL, err = url.Parse(req.URL)
		if err != nil {
			return nil, fmt.Errorf("curlutil: invalid URL: %w", err)
		}
	}

	// Defaults
	if req.Method == "" {
		req.Method = "GET"
	}
	if req.Timeout == 0 {
		req.Timeout = DefaultTimeout
	}
	if req.Method == "HEAD" {
		req.HeadOnly = true
	}

	// Build transport
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: !req.VerifySSL,
		},
	}

	client := &http.Client{
		Timeout:   time.Duration(req.Timeout) * time.Second,
		Transport: transport,
	}

	// Redirect handling
	var redirectChain []string
	if !req.FollowRedirect {
		client.CheckRedirect = func(r *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		}
	} else {
		client.CheckRedirect = func(newReq *http.Request, via []*http.Request) error {
			redirectChain = append(redirectChain, newReq.URL.String())
			if len(via) >= MaxRedirects {
				return fmt.Errorf("curlutil: too many redirects")
			}
			return nil
		}
	}

	// Build request
	var bodyReader io.Reader
	if req.Body != "" && !req.HeadOnly {
		bodyReader = strings.NewReader(req.Body)
	}

	httpReq, err := http.NewRequestWithContext(ctx, req.Method, req.URL, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("curlutil: create request: %w", err)
	}

	// Set headers
	for key, value := range req.Headers {
		httpReq.Header.Set(key, value)
	}
	if httpReq.Header.Get("User-Agent") == "" {
		httpReq.Header.Set("User-Agent", DefaultUserAgent)
	}

	// Execute
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("curlutil: request failed: %w", err)
	}
	defer resp.Body.Close()

	responseTime := time.Since(startTime).Milliseconds()

	// Build response headers
	headers := make(map[string]string)
	for key, values := range resp.Header {
		headers[key] = strings.Join(values, ", ")
	}

	// Build request info
	requestHeaders := make(map[string]string)
	for key, values := range httpReq.Header {
		requestHeaders[key] = strings.Join(values, ", ")
	}

	requestInfo := RequestInfo{
		FinalURL:       resp.Request.URL.String(),
		Protocol:       resp.Proto,
		RequestHeaders: requestHeaders,
	}

	if resp.Request.RemoteAddr != "" {
		requestInfo.RemoteAddr = resp.Request.RemoteAddr
	}

	if resp.TLS != nil {
		requestInfo.TLSVersion = tlsVersionString(resp.TLS.Version)
	}

	// Read body
	var bodyBytes []byte
	var bodyStr, bodyPreview string
	var isBinary bool
	var bodySize int64

	if !req.HeadOnly && req.Method != "HEAD" {
		bodyBytes, err = io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("curlutil: read response body: %w", err)
		}

		bodySize = int64(len(bodyBytes))
		isBinary = !utf8.Valid(bodyBytes) || isBinaryContent(resp.Header.Get("Content-Type"))

		if isBinary {
			bodyStr = fmt.Sprintf("[binary data - %d bytes]", len(bodyBytes))
			bodyPreview = generateBinaryPreview(bodyBytes, resp.Header.Get("Content-Type"))
		} else {
			bodyStr = string(bodyBytes)
			if len(bodyStr) > MaxBodyPreview {
				bodyPreview = bodyStr[:MaxBodyPreview] + "\n\n... [truncated]"
			} else {
				bodyPreview = bodyStr
			}
		}
	} else {
		bodyStr = "[HEAD request - headers only]"
		bodyPreview = bodyStr
		bodySize = resp.ContentLength
	}

	return &Response{
		URL:           req.URL,
		Method:        req.Method,
		StatusCode:    resp.StatusCode,
		StatusText:    resp.Status,
		Headers:       headers,
		Body:          bodyStr,
		BodyPreview:   bodyPreview,
		BodySize:      bodySize,
		IsBinary:      isBinary,
		ResponseTime:  responseTime,
		ContentLength: resp.ContentLength,
		ContentType:   resp.Header.Get("Content-Type"),
		RedirectChain: redirectChain,
		RequestInfo:   requestInfo,
	}, nil
}

// ─── Curl command parser ────────────────────────────────────────

// ParseCurlCommand parses a curl command string into a Request.
// Supports common flags: -X, -H, -d, -k, -L, -I, --data-raw, --compressed.
func ParseCurlCommand(curlCmd string) (*Request, error) {
	curlCmd = strings.TrimSpace(curlCmd)
	if curlCmd == "" {
		return nil, fmt.Errorf("curlutil: empty curl command")
	}

	// Remove "curl " prefix
	if strings.HasPrefix(curlCmd, "curl ") {
		curlCmd = curlCmd[5:]
	} else if strings.HasPrefix(curlCmd, "curl\t") {
		curlCmd = curlCmd[5:]
	}

	req := &Request{
		Method:         "GET",
		Headers:        make(map[string]string),
		FollowRedirect: false,
		VerifySSL:      true,
		Timeout:        DefaultTimeout,
	}

	// Tokenize, respecting quoted strings
	tokens, err := tokenizeCurl(curlCmd)
	if err != nil {
		return nil, err
	}

	for i := 0; i < len(tokens); i++ {
		token := tokens[i]

		switch {
		case token == "-I" || token == "--head":
			req.Method = "HEAD"
			req.HeadOnly = true

		case token == "-X" || token == "--request":
			if i+1 < len(tokens) {
				req.Method = strings.ToUpper(tokens[i+1])
				i++
			}

		case token == "-H" || token == "--header":
			if i+1 < len(tokens) {
				header := tokens[i+1]
				if colonIndex := strings.Index(header, ":"); colonIndex > 0 {
					key := strings.TrimSpace(header[:colonIndex])
					value := strings.TrimSpace(header[colonIndex+1:])
					req.Headers[key] = value
				}
				i++
			}

		case token == "-d" || token == "--data" || token == "--data-raw" || token == "--data-binary":
			if i+1 < len(tokens) {
				req.Body = tokens[i+1]
				if req.Method == "GET" {
					req.Method = "POST"
				}
				i++
			}

		case token == "-k" || token == "--insecure":
			req.VerifySSL = false

		case token == "-L" || token == "--location":
			req.FollowRedirect = true

		case token == "--compressed":
			// Accept header handled by Go automatically
			if req.Headers["Accept-Encoding"] == "" {
				req.Headers["Accept-Encoding"] = "gzip, deflate"
			}

		case token == "-u" || token == "--user":
			if i+1 < len(tokens) {
				req.Headers["Authorization"] = "Basic " + base64Encode(tokens[i+1])
				i++
			}

		case token == "-A" || token == "--user-agent":
			if i+1 < len(tokens) {
				req.Headers["User-Agent"] = tokens[i+1]
				i++
			}

		case token == "-e" || token == "--referer":
			if i+1 < len(tokens) {
				req.Headers["Referer"] = tokens[i+1]
				i++
			}

		case token == "--connect-timeout" || token == "--max-time":
			if i+1 < len(tokens) {
				if t, err := parseInt(tokens[i+1]); err == nil {
					req.Timeout = t
				}
				i++
			}

		case strings.HasPrefix(token, "http://") || strings.HasPrefix(token, "https://"):
			req.URL = token

		case strings.HasPrefix(token, "'http") || strings.HasPrefix(token, "\"http"):
			req.URL = strings.Trim(token, "'\"")

		case !strings.HasPrefix(token, "-") && req.URL == "":
			// Might be a URL without protocol
			if strings.Contains(token, ".") || strings.Contains(token, ":") {
				req.URL = token
			}
		}
	}

	if req.URL == "" {
		return nil, fmt.Errorf("curlutil: no URL found in curl command")
	}

	return req, nil
}

// ─── Helpers ────────────────────────────────────────────────────

// isBinaryContent checks if a content type is likely binary.
func isBinaryContent(contentType string) bool {
	binaryPrefixes := []string{
		"image/", "audio/", "video/",
		"application/octet-stream", "application/pdf",
		"application/zip", "application/gzip",
		"application/x-", "font/", "model/",
	}

	contentType = strings.ToLower(contentType)
	for _, prefix := range binaryPrefixes {
		if strings.HasPrefix(contentType, prefix) {
			return true
		}
	}
	return false
}

// generateBinaryPreview creates a hex+ASCII preview of binary data.
func generateBinaryPreview(data []byte, contentType string) string {
	var sb strings.Builder

	fmt.Fprintf(&sb, "Content-Type: %s\n", contentType)
	fmt.Fprintf(&sb, "Size: %d bytes\n\n", len(data))

	switch {
	case strings.HasPrefix(contentType, "image/"):
		sb.WriteString("[Image file]\n")
	case strings.HasPrefix(contentType, "audio/"):
		sb.WriteString("[Audio file]\n")
	case strings.HasPrefix(contentType, "video/"):
		sb.WriteString("[Video file]\n")
	case strings.HasPrefix(contentType, "application/pdf"):
		sb.WriteString("[PDF document]\n")
	case strings.HasPrefix(contentType, "application/zip"):
		sb.WriteString("[Zip archive]\n")
	default:
		sb.WriteString("[Binary file]\n")
	}

	sb.WriteString("\nHex preview (first 64 bytes):\n")
	maxBytes := 64
	if len(data) < maxBytes {
		maxBytes = len(data)
	}

	for i := 0; i < maxBytes; i += 16 {
		end := i + 16
		if end > maxBytes {
			end = maxBytes
		}

		var hexPart strings.Builder
		for j := i; j < end; j++ {
			fmt.Fprintf(&hexPart, "%02x ", data[j])
		}

		var asciiPart strings.Builder
		for j := i; j < end; j++ {
			if data[j] >= 32 && data[j] <= 126 {
				asciiPart.WriteByte(data[j])
			} else {
				asciiPart.WriteByte('.')
			}
		}

		fmt.Fprintf(&sb, "%04x: %-48s |%s|\n", i, hexPart.String(), asciiPart.String())
	}

	if len(data) > maxBytes {
		sb.WriteString("...\n")
	}

	return sb.String()
}

// tlsVersionString converts a TLS version uint16 to a readable string.
func tlsVersionString(version uint16) string {
	switch version {
	case tls.VersionTLS10:
		return "TLS 1.0"
	case tls.VersionTLS11:
		return "TLS 1.1"
	case tls.VersionTLS12:
		return "TLS 1.2"
	case tls.VersionTLS13:
		return "TLS 1.3"
	default:
		return fmt.Sprintf("TLS 0x%04x", version)
	}
}

// tokenizeCurl splits a curl command into tokens, respecting single/double quotes.
func tokenizeCurl(s string) ([]string, error) {
	var tokens []string
	var current strings.Builder
	var inSingle, inDouble bool

	for i := 0; i < len(s); i++ {
		ch := s[i]

		switch {
		case ch == '\\' && !inSingle && i+1 < len(s):
			// Escape next character
			i++
			current.WriteByte(s[i])

		case ch == '\'' && !inDouble:
			inSingle = !inSingle

		case ch == '"' && !inSingle:
			inDouble = !inDouble

		case (ch == ' ' || ch == '\t' || ch == '\n') && !inSingle && !inDouble:
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}

		default:
			current.WriteByte(ch)
		}
	}

	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}

	if inSingle || inDouble {
		return nil, fmt.Errorf("curlutil: unterminated quote in curl command")
	}

	return tokens, nil
}

// base64Encode returns the standard base64 encoding of s, used for the
// -u (Basic auth) flag. It delegates to crypto.Base64Encode.
func base64Encode(s string) string {
	return crypto.Base64Encode([]byte(s))
}

// parseInt is a helper to parse an int.
func parseInt(s string) (int, error) {
	return strconv.Atoi(s)
}
