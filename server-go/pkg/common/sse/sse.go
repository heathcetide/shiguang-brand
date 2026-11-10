// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package sse implements Server-Sent Events (SSE) for both the server side
// (writing events to an HTTP response) and the client side (connecting to an
// SSE endpoint and streaming events).
//
// The implementation follows the [SSE specification]: events are UTF-8 text
// separated by blank lines, with fields prefixed by "field: value".
//
// # Quick start (server)
//
//	func handler(w http.ResponseWriter, r *http.Request) {
//	    sse.SetHeaders(w)
//	    w, err := sse.NewWriter(w)
//	    if err != nil { http.Error(w, err.Error(), 500); return }
//	    defer w.Close()
//	    w.WriteData("hello")
//	    w.Write(&sse.Event{ID: "1", Event: "ping", Data: "pong"})
//	}
//
// # Quick start (client)
//
//	client := sse.NewClient("http://example.com/events")
//	stream, err := client.Connect(ctx)
//	if err != nil { log.Fatal(err) }
//	defer stream.Close()
//	for {
//	    ev, err := stream.Next()
//	    if err != nil { break }
//	    log.Println(ev.Data)
//	}
//
// [SSE specification]: https://html.spec.whatwg.org/multipage/server-sent-events.html
package sse

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrFlusherNotSupported is returned when the http.ResponseWriter does not
	// implement http.Flusher, which is required for SSE.
	ErrFlusherNotSupported = errors.New("sse: response writer does not support http.Flusher")
)

// ──────────────────────────────────────────────
// Event
// ──────────────────────────────────────────────

// Event represents a single Server-Sent Event. The zero value is a valid
// event with no data.
type Event struct {
	ID    string // event id (id: field)
	Event string // event type (event: field)
	Data  string // event data (data: field, may span multiple lines)
	Retry int    // reconnection hint in ms (retry: field); 0 means unset
}

// ──────────────────────────────────────────────
// Writer (server side)
// ──────────────────────────────────────────────

// Writer writes SSE events to an http.ResponseWriter. It buffers output and
// flushes after each event so clients receive them immediately.
type Writer struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

// NewWriter creates a Writer that writes SSE events to w. It returns
// ErrFlusherNotSupported if w does not implement http.Flusher.
func NewWriter(w http.ResponseWriter) (*Writer, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, ErrFlusherNotSupported
	}
	return &Writer{w: w, flusher: flusher}, nil
}

// SetHeaders sets the standard SSE response headers on w:
// Content-Type: text/event-stream, Cache-Control: no-cache, and
// Connection: keep-alive. It should be called before writing the body.
func SetHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
}

// Write writes a single event to the stream and flushes. If the event has no
// populated fields nothing is written (but a flush still occurs).
func (w *Writer) Write(event *Event) error {
	if event == nil {
		return nil
	}
	var b strings.Builder
	if event.ID != "" {
		b.WriteString("id: ")
		b.WriteString(event.ID)
		b.WriteByte('\n')
	}
	if event.Event != "" {
		b.WriteString("event: ")
		b.WriteString(event.Event)
		b.WriteByte('\n')
	}
	if event.Data != "" {
		for _, line := range strings.Split(event.Data, "\n") {
			b.WriteString("data: ")
			b.WriteString(line)
			b.WriteByte('\n')
		}
	}
	if event.Retry > 0 {
		b.WriteString("retry: ")
		fmt.Fprintf(&b, "%d", event.Retry)
		b.WriteByte('\n')
	}
	b.WriteByte('\n') // blank line terminates the event

	if _, err := io.WriteString(w.w, b.String()); err != nil {
		return err
	}
	w.flusher.Flush()
	return nil
}

// WriteData is a convenience that writes an event containing only the data
// field.
func (w *Writer) WriteData(data string) error {
	return w.Write(&Event{Data: data})
}

// WriteComment writes a comment line (starts with ":"). Comments are ignored
// by clients but keep the connection alive.
func (w *Writer) WriteComment(comment string) error {
	var b strings.Builder
	for _, line := range strings.Split(comment, "\n") {
		b.WriteString(": ")
		b.WriteString(line)
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	if _, err := io.WriteString(w.w, b.String()); err != nil {
		return err
	}
	w.flusher.Flush()
	return nil
}

// WriteRetry sets the reconnection timeout hint (retry: field) in milliseconds.
func (w *Writer) WriteRetry(ms int) error {
	return w.Write(&Event{Retry: ms})
}

// Close writes a final flush. It is safe to call multiple times. Currently it
// is a no-op flush but is provided for symmetry and future use.
func (w *Writer) Close() error {
	w.flusher.Flush()
	return nil
}

// ──────────────────────────────────────────────
// Client (client side)
// ──────────────────────────────────────────────

// Client connects to an SSE endpoint and streams events.
type Client struct {
	url        string
	httpClient *http.Client
}

// NewClient creates a Client for the given SSE endpoint URL.
func NewClient(url string) *Client {
	return &Client{url: url, httpClient: &http.Client{}}
}

// WithHTTPClient sets a custom *http.Client and returns the receiver for
// chaining.
func (c *Client) WithHTTPClient(hc *http.Client) *Client {
	c.httpClient = hc
	return c
}

// StreamReader reads SSE events from a response body.
type StreamReader struct {
	resp    *http.Response
	scanner *bufio.Scanner
	err     error
	closed  bool
	// pending fields accumulated across lines until a blank line dispatches
	// the event.
	id    string
	event string
	data  []string
	retry int
}

// Connect issues a GET request to the client's URL and returns a StreamReader
// for the resulting event stream. The request is cancelled when ctx is done.
func (c *Client) Connect(ctx context.Context) (*StreamReader, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("sse: unexpected status code %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	return &StreamReader{resp: resp, scanner: scanner}, nil
}

// Next reads and returns the next event from the stream. It returns io.EOF
// when the stream ends. Comment lines and retry fields are consumed silently
// (retry updates the reader's internal value but is not surfaced as an event
// unless accompanied by data).
func (s *StreamReader) Next() (*Event, error) {
	for s.scanner.Scan() {
		line := s.scanner.Text()
		// Remove a single trailing CR (CRLF line endings).
		line = strings.TrimSuffix(line, "\r")

		// Blank line dispatches the accumulated event.
		if line == "" {
			ev := s.buildEvent()
			if ev == nil {
				continue // nothing accumulated (e.g. only comments)
			}
			return ev, nil
		}

		// Comment line.
		if line[0] == ':' {
			continue
		}

		field, value := line, ""
		if idx := strings.Index(line, ":"); idx != -1 {
			field = line[:idx]
			value = line[idx+1:]
			// A single leading space after the colon is stripped per spec.
			if strings.HasPrefix(value, " ") {
				value = value[1:]
			}
		}

		switch field {
		case "id":
			s.id = value
		case "event":
			s.event = value
		case "data":
			s.data = append(s.data, value)
		case "retry":
			if n, err := strconv.Atoi(value); err == nil {
				s.retry = n
			}
		default:
			// Unknown field: ignore per spec.
		}
	}

	if err := s.scanner.Err(); err != nil {
		s.err = err
		return nil, err
	}
	return nil, io.EOF
}

// buildEvent assembles the accumulated fields into an Event and resets the
// accumulators. Returns nil if no data/event/id was accumulated.
func (s *StreamReader) buildEvent() *Event {
	if len(s.data) == 0 && s.id == "" && s.event == "" {
		// Reset retry accumulator even when no event.
		s.retry = 0
		return nil
	}
	ev := &Event{
		ID:    s.id,
		Event: s.event,
		Retry: s.retry,
		Data:  strings.Join(s.data, "\n"),
	}
	s.id = ""
	s.event = ""
	s.data = s.data[:0]
	s.retry = 0
	return ev
}

// Err returns the last non-EOF error encountered while reading.
func (s *StreamReader) Err() error {
	return s.err
}

// Close closes the underlying response body. It is safe to call multiple
// times.
func (s *StreamReader) Close() error {
	if s.closed {
		return nil
	}
	s.closed = true
	return s.resp.Body.Close()
}

// ──────────────────────────────────────────────
// ParseEvent
// ──────────────────────────────────────────────

// ParseEvent parses a block of SSE-formatted text (one or more "field: value"
// lines terminated by a blank line) into an Event. It is useful for testing
// or for consuming SSE payloads from non-streaming sources.
func ParseEvent(data string) *Event {
	ev := &Event{}
	for _, line := range strings.Split(data, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if line == "" || line[0] == ':' {
			continue
		}
		field, value := line, ""
		if idx := strings.Index(line, ":"); idx != -1 {
			field = line[:idx]
			value = line[idx+1:]
			if strings.HasPrefix(value, " ") {
				value = value[1:]
			}
		}
		switch field {
		case "id":
			ev.ID = value
		case "event":
			ev.Event = value
		case "data":
			if ev.Data != "" {
				ev.Data += "\n"
			}
			ev.Data += value
		case "retry":
			if n, err := strconv.Atoi(value); err == nil {
				ev.Retry = n
			}
		}
	}
	return ev
}
