// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package netutil provides network utilities:
//
//   - Port availability: IsPortAvailable, FindAvailablePort, FreePort
//   - IP address helpers: LocalIPs, PublicIP, IsPrivateIP, IsLoopback
//   - HTTP client with retry, timeout, and circuit breaker
//   - TCP/UDP utilities: dial, listen, ping, forward
//
// # Quick start
//
//	// Check if a port is available
//	ok := netutil.IsPortAvailable("tcp", 8080)
//
//	// Get local IP
//	ip := netutil.LocalIP()
//
//	// HTTP client with retry
//	client := netutil.NewHTTPClient(netutil.HTTPClientConfig{
//	    Timeout:       10 * time.Second,
//	    MaxRetries:    3,
//	    RetryInterval: time.Second,
//	})
//	resp, err := client.Get("https://example.com")
package netutil

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// ──────────────────────────────────────────────
// Port availability
// ──────────────────────────────────────────────

// IsPortAvailable checks if a TCP/UDP port is available on localhost.
func IsPortAvailable(network string, port int) bool {
	switch strings.ToLower(network) {
	case "tcp", "tcp4", "tcp6":
		ln, err := net.Listen(network, fmt.Sprintf(":%d", port))
		if err != nil {
			return false
		}
		_ = ln.Close()
		return true
	case "udp", "udp4", "udp6":
		ln, err := net.ListenPacket(network, fmt.Sprintf(":%d", port))
		if err != nil {
			return false
		}
		_ = ln.Close()
		return true
	default:
		return false
	}
}

// IsTCPPortAvailable checks if a TCP port is available.
func IsTCPPortAvailable(port int) bool {
	return IsPortAvailable("tcp", port)
}

// IsUDPPortAvailable checks if a UDP port is available.
func IsUDPPortAvailable(port int) bool {
	return IsPortAvailable("udp", port)
}

// FreePort returns a free TCP port provided by the OS.
// The port is not reserved; another process may grab it.
func FreePort() (int, error) {
	ln, err := net.Listen("tcp", ":0")
	if err != nil {
		return 0, fmt.Errorf("netutil: get free port: %w", err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

// FreeUDPPort returns a free UDP port provided by the OS.
func FreeUDPPort() (int, error) {
	ln, err := net.ListenPacket("udp", ":0")
	if err != nil {
		return 0, fmt.Errorf("netutil: get free UDP port: %w", err)
	}
	defer ln.Close()
	return ln.LocalAddr().(*net.UDPAddr).Port, nil
}

// FindAvailablePort finds the first available TCP port starting from start.
// Returns an error if no port is found within [start, end].
func FindAvailablePort(start, end int) (int, error) {
	for port := start; port <= end; port++ {
		if IsTCPPortAvailable(port) {
			return port, nil
		}
	}
	return 0, fmt.Errorf("netutil: no available port in range [%d, %d]", start, end)
}

// FindAvailablePorts finds n available TCP ports starting from start.
func FindAvailablePorts(start, n int) ([]int, error) {
	ports := make([]int, 0, n)
	port := start
	for len(ports) < n {
		if port > 65535 {
			return nil, fmt.Errorf("netutil: could not find %d available ports starting from %d", n, start)
		}
		if IsTCPPortAvailable(port) {
			ports = append(ports, port)
		}
		port++
	}
	return ports, nil
}

// ──────────────────────────────────────────────
// IP address helpers
// ──────────────────────────────────────────────

// LocalIP returns the first non-loopback IPv4 address of the machine.
// Returns "" if no non-loopback address is found.
func LocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				return ipnet.IP.String()
			}
		}
	}
	return ""
}

// LocalIPs returns all non-loopback IPv4 addresses of the machine.
func LocalIPs() []string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var ips []string
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				ips = append(ips, ipnet.IP.String())
			}
		}
	}
	return ips
}

// LocalIPv6s returns all non-loopback IPv6 addresses of the machine.
func LocalIPv6s() []string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var ips []string
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() == nil && ipnet.IP.To16() != nil {
				ips = append(ips, ipnet.IP.String())
			}
		}
	}
	return ips
}

// AllIPs returns all IP addresses (v4 and v6) including loopback.
func AllIPs() []string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var ips []string
	for _, addr := range addrs {
		var ip net.IP
		switch v := addr.(type) {
		case *net.IPNet:
			ip = v.IP
		case *net.IPAddr:
			ip = v.IP
		}
		if ip != nil {
			ips = append(ips, ip.String())
		}
	}
	return ips
}

// OutboundIP returns the local IP address used to reach the given target.
// If target is empty, it uses "8.8.8.8:80" as a public target.
func OutboundIP(target string) (string, error) {
	if target == "" {
		target = "8.8.8.8:80"
	}
	conn, err := net.Dial("udp", target)
	if err != nil {
		return "", fmt.Errorf("netutil: get outbound IP: %w", err)
	}
	defer conn.Close()
	localAddr := conn.LocalAddr().(*net.UDPAddr)
	return localAddr.IP.String(), nil
}

// PublicIP fetches the public IP address using an external service.
// Uses https://api.ipify.org by default. Returns "" on error.
func PublicIP() string {
	return PublicIPWithProvider("https://api.ipify.org")
}

// PublicIPWithProvider fetches the public IP using the given provider URL.
// The response body should be just the IP address.
func PublicIPWithProvider(url string) string {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}

// IsPrivateIP returns true if the IP is in a private range.
// Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7.
func IsPrivateIP(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil {
		switch {
		case ip4[0] == 10:
			return true
		case ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31:
			return true
		case ip4[0] == 192 && ip4[1] == 168:
			return true
		}
		return false
	}
	// IPv6: fc00::/7
	return ip[0]&0xfe == 0xfc
}

// IsLoopback returns true if the IP is a loopback address.
func IsLoopback(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

// IsPublicIP returns true if the IP is not private and not loopback.
func IsPublicIP(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	return !IsPrivateIP(ipStr) && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified()
}

// IPRange returns the start and end IPs of a CIDR range.
// Returns an error if the CIDR is invalid.
func IPRange(cidr string) (start, end string, err error) {
	_, ipnet, err := net.ParseCIDR(cidr)
	if err != nil {
		return "", "", fmt.Errorf("netutil: parse CIDR: %w", err)
	}
	start = ipnet.IP.String()
	broadcast := make(net.IP, len(ipnet.IP))
	for i := range ipnet.IP {
		broadcast[i] = ipnet.IP[i] | ^ipnet.Mask[i]
	}
	end = broadcast.String()
	return start, end, nil
}

// ──────────────────────────────────────────────
// HTTP client with retry, timeout, circuit breaker
// ──────────────────────────────────────────────

// HTTPClientConfig configures the retry HTTP client.
type HTTPClientConfig struct {
	Timeout         time.Duration   // total request timeout (default 30s)
	MaxRetries      int             // max retry attempts (default 3)
	RetryInterval   time.Duration   // base interval between retries (default 1s)
	RetryMaxWait    time.Duration   // max wait between retries (default 30s)
	RetryableStatus map[int]bool    // status codes that trigger retry (default 429, 500, 502, 503, 504)
	Transport       *http.Transport // custom transport (optional)
	CircuitBreaker  *CircuitBreaker // optional circuit breaker
	CheckRedirect   func(req *http.Request, via []*http.Request) error // optional redirect policy
	Jar             http.CookieJar  // optional cookie jar
}

// HTTPClient wraps http.Client with retry and circuit breaker support.
type HTTPClient struct {
	client         *http.Client
	config         HTTPClientConfig
	circuitBreaker *CircuitBreaker
}

// NewHTTPClient creates a new retry-enabled HTTP client.
func NewHTTPClient(cfg HTTPClientConfig) *HTTPClient {
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.MaxRetries < 0 {
		cfg.MaxRetries = 0
	}
	if cfg.RetryInterval == 0 {
		cfg.RetryInterval = time.Second
	}
	if cfg.RetryMaxWait == 0 {
		cfg.RetryMaxWait = 30 * time.Second
	}
	if cfg.RetryableStatus == nil {
		cfg.RetryableStatus = map[int]bool{
			429: true, 500: true, 502: true, 503: true, 504: true,
		}
	}

	transport := cfg.Transport
	if transport == nil {
		transport = &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		}
	}

	return &HTTPClient{
		client: &http.Client{
			Timeout:       cfg.Timeout,
			Transport:     transport,
			CheckRedirect: cfg.CheckRedirect,
			Jar:           cfg.Jar,
		},
		config:         cfg,
		circuitBreaker: cfg.CircuitBreaker,
	}
}

// NewStandardHTTPClient returns a plain *http.Client configured with
// timeout, transport, redirect policy and cookie jar from cfg. Unlike
// NewHTTPClient it does NOT wrap the client with retry or circuit-breaker
// logic — useful for callers (e.g. security scanners) that need to
// observe raw responses without retry masking.
func NewStandardHTTPClient(cfg HTTPClientConfig) *http.Client {
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	transport := cfg.Transport
	if transport == nil {
		transport = &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		}
	}
	return &http.Client{
		Timeout:       cfg.Timeout,
		Transport:     transport,
		CheckRedirect: cfg.CheckRedirect,
		Jar:           cfg.Jar,
	}
}

// Do executes an HTTP request with retry logic.
func (c *HTTPClient) Do(req *http.Request) (*http.Response, error) {
	var lastErr error
	var lastResp *http.Response

	for attempt := 0; attempt <= c.config.MaxRetries; attempt++ {
		// Circuit breaker check.
		if c.circuitBreaker != nil {
			if !c.circuitBreaker.Allow() {
				return nil, fmt.Errorf("netutil: circuit breaker open")
			}
		}

		resp, err := c.client.Do(req)
		if err == nil {
			// Check if status is retryable.
			if c.config.RetryableStatus[resp.StatusCode] && attempt < c.config.MaxRetries {
				_ = resp.Body.Close()
				c.wait(attempt)
				continue
			}

			// Success or non-retryable status.
			if c.circuitBreaker != nil {
				if resp.StatusCode >= 500 {
					c.circuitBreaker.RecordFailure()
				} else {
					c.circuitBreaker.RecordSuccess()
				}
			}
			return resp, nil
		}

		lastErr = err
		lastResp = nil

		if c.circuitBreaker != nil {
			c.circuitBreaker.RecordFailure()
		}

		if attempt < c.config.MaxRetries {
			c.wait(attempt)
		}
	}

	if lastResp != nil {
		return lastResp, nil
	}
	return nil, fmt.Errorf("netutil: request failed after %d retries: %w", c.config.MaxRetries, lastErr)
}

// Get sends a GET request.
func (c *HTTPClient) Get(url string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	return c.Do(req)
}

// Post sends a POST request.
func (c *HTTPClient) Post(url, contentType string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	return c.Do(req)
}

// GetWithContext sends a GET request with context.
func (c *HTTPClient) GetWithContext(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	return c.Do(req)
}

// PostWithContext sends a POST request with context.
func (c *HTTPClient) PostWithContext(ctx context.Context, url, contentType string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	return c.Do(req)
}

// wait sleeps for the retry backoff interval.
func (c *HTTPClient) wait(attempt int) {
	// Exponential backoff: interval * 2^attempt, capped at RetryMaxWait.
	wait := c.config.RetryInterval << uint(attempt)
	if wait > c.config.RetryMaxWait {
		wait = c.config.RetryMaxWait
	}
	time.Sleep(wait)
}

// ──────────────────────────────────────────────
// Circuit breaker
// ──────────────────────────────────────────────

// CircuitState represents the state of a circuit breaker.
type CircuitState int

const (
	CircuitClosed   CircuitState = iota // normal operation
	CircuitOpen                         // rejecting requests
	CircuitHalfOpen                     // testing if service is back
)

// CircuitBreaker implements a simple circuit breaker.
type CircuitBreaker struct {
	threshold    int           // failures before opening
	timeout      time.Duration // open state duration before half-open
	maxHalfOpen  int           // max half-open attempts
	state        CircuitState
	failures     int
	halfOpenReqs int
	openedAt     time.Time
}

// NewCircuitBreaker creates a circuit breaker that opens after threshold
// consecutive failures and stays open for timeout before entering half-open.
func NewCircuitBreaker(threshold int, timeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		threshold:   threshold,
		timeout:     timeout,
		maxHalfOpen: 1,
		state:       CircuitClosed,
	}
}

// Allow returns true if a request is allowed through.
func (cb *CircuitBreaker) Allow() bool {
	switch cb.state {
	case CircuitClosed:
		return true
	case CircuitOpen:
		if time.Since(cb.openedAt) >= cb.timeout {
			cb.state = CircuitHalfOpen
			cb.halfOpenReqs = 0
			return true
		}
		return false
	case CircuitHalfOpen:
		if cb.halfOpenReqs < cb.maxHalfOpen {
			cb.halfOpenReqs++
			return true
		}
		return false
	}
	return true
}

// RecordSuccess records a successful request.
func (cb *CircuitBreaker) RecordSuccess() {
	cb.failures = 0
	cb.state = CircuitClosed
}

// RecordFailure records a failed request.
func (cb *CircuitBreaker) RecordFailure() {
	cb.failures++
	if cb.state == CircuitHalfOpen {
		cb.state = CircuitOpen
		cb.openedAt = time.Now()
		return
	}
	if cb.failures >= cb.threshold {
		cb.state = CircuitOpen
		cb.openedAt = time.Now()
	}
}

// State returns the current circuit breaker state.
func (cb *CircuitBreaker) State() CircuitState {
	return cb.state
}

// Failures returns the current failure count.
func (cb *CircuitBreaker) Failures() int {
	return cb.failures
}

// Reset resets the circuit breaker to closed state.
func (cb *CircuitBreaker) Reset() {
	cb.failures = 0
	cb.halfOpenReqs = 0
	cb.state = CircuitClosed
}

// ──────────────────────────────────────────────
// TCP utilities
// ──────────────────────────────────────────────

// TCPConnect attempts to connect to a TCP address with a timeout.
// Returns nil if connection succeeds.
func TCPConnect(addr string, timeout time.Duration) error {
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return fmt.Errorf("netutil: TCP connect %s: %w", addr, err)
	}
	_ = conn.Close()
	return nil
}

// TCPPing checks if a TCP address is reachable within the timeout.
// Returns the round-trip duration.
func TCPPing(addr string, timeout time.Duration) (time.Duration, error) {
	start := time.Now()
	err := TCPConnect(addr, timeout)
	if err != nil {
		return 0, err
	}
	return time.Since(start), nil
}

// IsTCPReachable returns true if a TCP address is reachable.
func IsTCPReachable(addr string, timeout time.Duration) bool {
	return TCPConnect(addr, timeout) == nil
}

// TCPExchange connects to a TCP address, sends data, and reads the response.
// Returns the response bytes.
func TCPExchange(addr string, data []byte, timeout time.Duration) ([]byte, error) {
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return nil, fmt.Errorf("netutil: TCP dial %s: %w", addr, err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(timeout))

	if _, err := conn.Write(data); err != nil {
		return nil, fmt.Errorf("netutil: TCP write: %w", err)
	}

	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, fmt.Errorf("netutil: TCP read: %w", err)
	}
	return buf[:n], nil
}

// TCPForward forwards data between two TCP connections (bidirectional).
// Blocks until either connection is closed.
func TCPForward(dst, src net.Conn) error {
	errCh := make(chan error, 2)
	go func() {
		_, err := io.Copy(dst, src)
		errCh <- err
	}()
	go func() {
		_, err := io.Copy(src, dst)
		errCh <- err
	}()
	return <-errCh
}

// ──────────────────────────────────────────────
// UDP utilities
// ──────────────────────────────────────────────

// UDPExchange sends data to a UDP address and reads the response.
func UDPExchange(addr string, data []byte, timeout time.Duration) ([]byte, error) {
	conn, err := net.DialTimeout("udp", addr, timeout)
	if err != nil {
		return nil, fmt.Errorf("netutil: UDP dial %s: %w", addr, err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(timeout))

	if _, err := conn.Write(data); err != nil {
		return nil, fmt.Errorf("netutil: UDP write: %w", err)
	}

	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, fmt.Errorf("netutil: UDP read: %w", err)
	}
	return buf[:n], nil
}

// UDPSend sends data to a UDP address without waiting for a response.
func UDPSend(addr string, data []byte) error {
	conn, err := net.Dial("udp", addr)
	if err != nil {
		return fmt.Errorf("netutil: UDP dial %s: %w", addr, err)
	}
	defer conn.Close()
	_, err = conn.Write(data)
	return err
}

// ──────────────────────────────────────────────
// DNS utilities
// ──────────────────────────────────────────────

// LookupHost resolves a hostname to IP addresses.
func LookupHost(hostname string) ([]string, error) {
	return net.LookupHost(hostname)
}

// LookupCNAME resolves the CNAME record for a hostname.
func LookupCNAME(hostname string) (string, error) {
	return net.LookupCNAME(hostname)
}

// LookupMX resolves MX records for a domain.
func LookupMX(domain string) ([]*net.MX, error) {
	return net.LookupMX(domain)
}

// LookupTXT resolves TXT records for a domain.
func LookupTXT(domain string) ([]string, error) {
	return net.LookupTXT(domain)
}

// ResolveIP resolves a hostname to a single IPv4 address.
// Returns "" if no IPv4 address is found.
func ResolveIP(hostname string) string {
	ips, err := net.LookupIP(hostname)
	if err != nil {
		return ""
	}
	for _, ip := range ips {
		if ip.To4() != nil {
			return ip.String()
		}
	}
	return ""
}

// ──────────────────────────────────────────────
// Interface utilities
// ──────────────────────────────────────────────

// Interfaces returns all network interface names.
func Interfaces() ([]string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("netutil: get interfaces: %w", err)
	}
	names := make([]string, len(ifaces))
	for i, iface := range ifaces {
		names[i] = iface.Name
	}
	return names, nil
}

// InterfaceIPs returns all IP addresses for the named interface.
func InterfaceIPs(name string) ([]string, error) {
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return nil, fmt.Errorf("netutil: get interface %s: %w", name, err)
	}
	addrs, err := iface.Addrs()
	if err != nil {
		return nil, fmt.Errorf("netutil: get addrs for %s: %w", name, err)
	}
	var ips []string
	for _, addr := range addrs {
		var ip net.IP
		switch v := addr.(type) {
		case *net.IPNet:
			ip = v.IP
		case *net.IPAddr:
			ip = v.IP
		}
		if ip != nil {
			ips = append(ips, ip.String())
		}
	}
	return ips, nil
}

// MACAddress returns the MAC address of the named interface.
// Returns "" if the interface has no MAC address.
func MACAddress(name string) (string, error) {
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return "", fmt.Errorf("netutil: get interface %s: %w", name, err)
	}
	return iface.HardwareAddr.String(), nil
}
