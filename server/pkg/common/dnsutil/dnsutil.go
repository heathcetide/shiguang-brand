// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package dnsutil provides advanced DNS query utilities.
//
// It wraps github.com/miekg/dns to offer a simple, high-level API for
// querying DNS records against any upstream server, with support for
// all common record types, EDNS0, DNSSEC, and concurrent multi-server
// lookups.
//
// # Quick start
//
//	records, err := dnsutil.Query("google.com", "A", "8.8.8.8:53")
//	// → []DNSRecord{{Name:"google.com.", Type:"A", TTL:300, Value:"142.250.191.14"}}
//
//	// Use a preset server
//	records, _ := dnsutil.QueryWithServer("example.com", "MX", dnsutil.ServerCloudflare)
//
//	// Query all record types concurrently
//	result, _ := dnsutil.QueryAll("example.com", "8.8.8.8:53")
//	// → AllRecords{A:[...], AAAA:[...], MX:[...], ...}
package dnsutil

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
)

// ─── Common DNS servers ─────────────────────────────────────────

const (
	ServerGoogle      = "8.8.8.8:53"
	ServerCloudflare  = "1.1.1.1:53"
	ServerCloudflare2 = "1.0.0.1:53"
	Server114         = "114.114.114.114:53"
	ServerAliDNS      = "223.5.5.5:53"
	ServerAliDNS2     = "223.6.6.6:53"
	ServerQuad9       = "9.9.9.9:53"
	ServerOpenDNS     = "208.67.222.222:53"
)

// DefaultServer is used when no server is specified.
const DefaultServer = ServerGoogle

// DefaultTimeout for DNS queries.
const DefaultTimeout = 5 * time.Second

// ─── Types ──────────────────────────────────────────────────────

// DNSRecord represents a single DNS record.
type DNSRecord struct {
	Name  string `json:"name"`  // Record name (FQDN)
	Type  string `json:"type"`  // Record type (A, AAAA, MX, ...)
	TTL   uint32 `json:"ttl"`   // Time to live (seconds)
	Value string `json:"value"` // Record value
}

// AllRecords holds records grouped by type from a QueryAll call.
type AllRecords struct {
	Domain string      `json:"domain"`
	Server string      `json:"server"`
	A      []DNSRecord `json:"a,omitempty"`
	AAAA   []DNSRecord `json:"aaaa,omitempty"`
	CNAME  []DNSRecord `json:"cname,omitempty"`
	MX     []DNSRecord `json:"mx,omitempty"`
	NS     []DNSRecord `json:"ns,omitempty"`
	TXT    []DNSRecord `json:"txt,omitempty"`
	SOA    []DNSRecord `json:"soa,omitempty"`
	PTR    []DNSRecord `json:"ptr,omitempty"`
	SRV    []DNSRecord `json:"srv,omitempty"`
	CAA    []DNSRecord `json:"caa,omitempty"`
}

// Client is a DNS query client.
type Client struct {
	server  string
	timeout time.Duration
	udp     bool // true = force UDP, false = auto (TCP for large responses)
	dnssec  bool // request DNSSEC records
}

// Option configures a Client.
type Option func(*Client)

// WithServer sets the default DNS server.
func WithServer(server string) Option {
	return func(c *Client) { c.server = normalizeServer(server) }
}

// WithTimeout sets the query timeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) { c.timeout = d }
}

// WithUDP forces UDP transport.
func WithUDP() Option {
	return func(c *Client) { c.udp = true }
}

// WithDNSSEC enables DNSSEC requests (sets DO bit + EDNS0).
func WithDNSSEC() Option {
	return func(c *Client) { c.dnssec = true }
}

// NewClient creates a DNS client with the given options.
func NewClient(opts ...Option) *Client {
	c := &Client{
		server:  DefaultServer,
		timeout: DefaultTimeout,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// ─── Package-level convenience functions ────────────────────────

// Query queries a single record type from a DNS server.
func Query(domain, recordType, server string) ([]DNSRecord, error) {
	return NewClient(WithServer(server)).Query(domain, recordType)
}

// QueryWithServer queries using a preset server constant.
func QueryWithServer(domain, recordType, server string) ([]DNSRecord, error) {
	return Query(domain, recordType, server)
}

// QueryA is a shortcut for A record queries.
func QueryA(domain, server string) ([]DNSRecord, error) {
	return Query(domain, "A", server)
}

// QueryAAAA is a shortcut for AAAA record queries.
func QueryAAAA(domain, server string) ([]DNSRecord, error) {
	return Query(domain, "AAAA", server)
}

// QueryMX is a shortcut for MX record queries.
func QueryMX(domain, server string) ([]DNSRecord, error) {
	return Query(domain, "MX", server)
}

// QueryNS is a shortcut for NS record queries.
func QueryNS(domain, server string) ([]DNSRecord, error) {
	return Query(domain, "NS", server)
}

// QueryTXT is a shortcut for TXT record queries.
func QueryTXT(domain, server string) ([]DNSRecord, error) {
	return Query(domain, "TXT", server)
}

// QueryCNAME is a shortcut for CNAME record queries.
func QueryCNAME(domain, server string) ([]DNSRecord, error) {
	return Query(domain, "CNAME", server)
}

// QuerySOA is a shortcut for SOA record queries.
func QuerySOA(domain, server string) ([]DNSRecord, error) {
	return Query(domain, "SOA", server)
}

// QueryPTR is a shortcut for PTR record queries (reverse DNS).
// Pass an IP address; it will be automatically converted to in-addr.arpa.
func QueryPTR(ip, server string) ([]DNSRecord, error) {
	zone, err := reverseZone(ip)
	if err != nil {
		return nil, err
	}
	return Query(zone, "PTR", server)
}

// QuerySRV is a shortcut for SRV record queries.
func QuerySRV(domain, server string) ([]DNSRecord, error) {
	return Query(domain, "SRV", server)
}

// QueryCAA is a shortcut for CAA record queries.
func QueryCAA(domain, server string) ([]DNSRecord, error) {
	return Query(domain, "CAA", server)
}

// QueryAll queries all common record types concurrently.
func QueryAll(domain, server string) (*AllRecords, error) {
	return NewClient(WithServer(server)).QueryAll(domain)
}

// ─── Client methods ─────────────────────────────────────────────

// Query queries a single record type using the client's configured server.
func (c *Client) Query(domain, recordType string) ([]DNSRecord, error) {
	return c.QueryContext(context.Background(), domain, recordType)
}

// QueryContext queries with a custom context.
func (c *Client) QueryContext(ctx context.Context, domain, recordType string) ([]DNSRecord, error) {
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return nil, fmt.Errorf("dnsutil: domain is empty")
	}

	qtype, ok := dns.StringToType[strings.ToUpper(recordType)]
	if !ok {
		return nil, fmt.Errorf("dnsutil: unsupported record type %q", recordType)
	}

	msg := new(dns.Msg)
	msg.SetQuestion(dns.Fqdn(domain), qtype)
	msg.RecursionDesired = true

	if c.dnssec {
		msg.SetEdns0(4096, true)
	}

	server := c.server
	if server == "" {
		server = DefaultServer
	}

	dnsClient := &dns.Client{
		Net:     autoNet(c.udp),
		Timeout: c.timeout,
	}

	resp, _, err := dnsClient.ExchangeContext(ctx, msg, server)
	if err != nil {
		return nil, fmt.Errorf("dnsutil: query %s %s via %s: %w", domain, recordType, server, err)
	}

	if resp.Rcode != dns.RcodeSuccess {
		return nil, &RcodeError{Rcode: resp.Rcode}
	}

	records := make([]DNSRecord, 0, len(resp.Answer))
	for _, rr := range resp.Answer {
		if r := parseRecord(rr); r != nil {
			records = append(records, *r)
		}
	}

	if len(records) == 0 {
		// Check Authority section for SOA (NXDOMAIN-like with info)
		for _, rr := range resp.Ns {
			if r := parseRecord(rr); r != nil {
				records = append(records, *r)
			}
		}
	}

	return records, nil
}

// QueryAll queries all common record types concurrently.
func (c *Client) QueryAll(domain string) (*AllRecords, error) {
	types := []string{"A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "PTR", "SRV", "CAA"}

	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		results = make(map[string][]DNSRecord)
		errs    []error
	)

	for _, rt := range types {
		wg.Add(1)
		go func(recordType string) {
			defer wg.Done()

			// PTR needs an IP, skip if domain is not an IP
			if recordType == "PTR" {
				if net.ParseIP(domain) == nil {
					return
				}
			}

			records, err := c.Query(domain, recordType)
			if err != nil {
				// Ignore NXDOMAIN (domain does not exist for this type),
				// only collect real errors.
				var rcodeErr *RcodeError
				if errors.As(err, &rcodeErr) && rcodeErr.Rcode == dns.RcodeNameError {
					return
				}
				mu.Lock()
				errs = append(errs, err)
				mu.Unlock()
				return
			}

			mu.Lock()
			results[recordType] = records
			mu.Unlock()
		}(rt)
	}
	wg.Wait()

	if len(errs) > 0 && len(results) == 0 {
		return nil, fmt.Errorf("dnsutil: all queries failed: %v", errs[0])
	}

	return &AllRecords{
		Domain: domain,
		Server: c.server,
		A:      results["A"],
		AAAA:   results["AAAA"],
		CNAME:  results["CNAME"],
		MX:     results["MX"],
		NS:     results["NS"],
		TXT:    results["TXT"],
		SOA:    results["SOA"],
		PTR:    results["PTR"],
		SRV:    results["SRV"],
		CAA:    results["CAA"],
	}, nil
}

// ─── Reverse DNS ────────────────────────────────────────────────

// ReverseLookup does a reverse DNS lookup for an IP address.
func ReverseLookup(ip, server string) ([]DNSRecord, error) {
	return QueryPTR(ip, server)
}

// ReverseLookupWithClient does reverse DNS using a configured client.
func (c *Client) ReverseLookup(ip string) ([]DNSRecord, error) {
	zone, err := reverseZone(ip)
	if err != nil {
		return nil, err
	}
	return c.Query(zone, "PTR")
}

// ─── Helpers ────────────────────────────────────────────────────

// RcodeError is returned when the DNS server responds with a non-success
// rcode. Callers can use errors.As to inspect the rcode (e.g. NXDOMAIN).
type RcodeError struct {
	Rcode int
}

func (e *RcodeError) Error() string {
	return fmt.Sprintf("dnsutil: server returned %s", dns.RcodeToString[e.Rcode])
}

// SupportedRecordTypes returns all supported record type names.
func SupportedRecordTypes() []string {
	types := make([]string, 0, len(dns.StringToType))
	for name := range dns.StringToType {
		types = append(types, name)
	}
	return types
}

// CommonRecordTypes returns the commonly used record types.
func CommonRecordTypes() []string {
	return []string{"A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "PTR", "SRV", "CAA"}
}

// normalizeServer ensures the server has a port.
func normalizeServer(server string) string {
	server = strings.TrimSpace(server)
	if server == "" {
		return DefaultServer
	}
	if !strings.Contains(server, ":") {
		return server + ":53"
	}
	return server
}

func autoNet(forceUDP bool) string {
	if forceUDP {
		return "udp"
	}
	return "" // empty = auto (try UDP, fallback TCP for truncated)
}

// reverseZone converts an IP to the in-addr.arpa / ip6.arpa zone.
func reverseZone(ipStr string) (string, error) {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return "", fmt.Errorf("dnsutil: invalid IP %q", ipStr)
	}

	if v4 := ip.To4(); v4 != nil {
		return fmt.Sprintf("%d.%d.%d.%d.in-addr.arpa.", v4[3], v4[2], v4[1], v4[0]), nil
	}

	// IPv6
	const hexDigits = "0123456789abcdef"
	ip = ip.To16()
	var parts []string
	for i := len(ip) - 1; i >= 0; i-- {
		b := ip[i]
		parts = append(parts, string(hexDigits[b&0xf]))
		parts = append(parts, string(hexDigits[b>>4]))
	}
	return strings.Join(parts, ".") + ".ip6.arpa.", nil
}

// parseRecord converts a dns.RR to a DNSRecord.
func parseRecord(rr dns.RR) *DNSRecord {
	header := rr.Header()
	r := &DNSRecord{
		Name:  header.Name,
		Type:  dns.TypeToString[header.Rrtype],
		TTL:   header.Ttl,
	}

	switch v := rr.(type) {
	case *dns.A:
		r.Value = v.A.String()
	case *dns.AAAA:
		r.Value = v.AAAA.String()
	case *dns.CNAME:
		r.Value = v.Target
	case *dns.MX:
		r.Value = fmt.Sprintf("%d %s", v.Preference, v.Mx)
	case *dns.NS:
		r.Value = v.Ns
	case *dns.TXT:
		r.Value = strings.Join(v.Txt, " ")
	case *dns.SOA:
		r.Value = fmt.Sprintf("%s %s %d %d %d %d %d",
			v.Ns, v.Mbox, v.Serial, v.Refresh, v.Retry, v.Expire, v.Minttl)
	case *dns.PTR:
		r.Value = v.Ptr
	case *dns.SRV:
		r.Value = fmt.Sprintf("%d %d %d %s", v.Priority, v.Weight, v.Port, v.Target)
	case *dns.CAA:
		r.Value = fmt.Sprintf("%d %s %q", v.Flag, v.Tag, v.Value)
	case *dns.DNAME:
		r.Value = v.Target
	case *dns.NAPTR:
		r.Value = fmt.Sprintf("%d %d %q %q %q %s",
			v.Order, v.Preference, v.Flags, v.Service, v.Regexp, v.Replacement)
	default:
		r.Value = rr.String()
	}

	return r
}
