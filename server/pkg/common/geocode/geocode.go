// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package geocode provides forward and reverse geocoding utilities
// using free, no-API-key-required services.
//
// It integrates multiple providers:
//
//   - Nominatim (OpenStreetMap): free, no key, 1 req/sec limit, global coverage
//   - BigDataCloud: free client-side reverse geocoding, no key, no rate limit
//
// # Quick start
//
//	// Reverse geocoding: lat/lon → address
//	addr, err := geocode.Reverse(39.9042, 116.4074)
//	// → "北京市东城区天安门广场", nil
//
//	// Forward geocoding: address → lat/lon
//	result, err := geocode.Forward("Eiffel Tower, Paris")
//	// → &geocode.GeocodeResult{Lat: 48.8584, Lon: 2.2945, ...}, nil
//
//	// Structured forward geocoding
//	result, err := geocode.ForwardStructured(&geocode.AddressQuery{
//	    City: "London",
//	    Country: "UK",
//	})
package geocode

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Provider identifies the geocoding service.
type Provider string

const (
	// ProviderNominatim uses OpenStreetMap Nominatim API.
	// Free, no key required, 1 req/sec rate limit, must set User-Agent.
	ProviderNominatim Provider = "nominatim"

	// ProviderBigDataCloud uses BigDataCloud reverse geocoding API.
	// Free, no key required, client-side focused but works server-side.
	ProviderBigDataCloud Provider = "bigdatacloud"
)

const (
	nominatimBaseURL      = "https://nominatim.openstreetmap.org"
	bigDataCloudBaseURL   = "https://api.bigdatacloud.net/data/reverse-geocode-client"
	defaultUserAgent      = "ling-base-geocode/1.0 (https://github.com/LingByte/ling-base)"
	defaultTimeout        = 10 * time.Second
	nominatimRateLimitMsg = "nominatim rate limit is 1 req/sec; consider caching results"
)

// GeocodeResult holds the result of a geocoding lookup.
type GeocodeResult struct {
	Lat          float64 // Latitude
	Lon          float64 // Longitude
	DisplayName  string  // Full human-readable address
	Country      string  // Country name
	CountryCode  string  // ISO 3166-1 alpha-2 country code
	State        string  // State / province / region
	StateDistrict string  // State district
	County       string  // County
	City         string  // City / town / village
	Postcode     string  // Postal code
	Street       string  // Street name
	HouseNumber  string  // House number
	Suburb       string  // Suburb / neighborhood
	Type         string  // OSM type (e.g. "city", "road", "building")
	Importance   float64 // Search rank importance (0-1)
	Provider     Provider // Which provider returned this result
}

// ReverseResult holds the result of a reverse geocoding lookup.
type ReverseResult struct {
	Lat           float64 // Latitude
	Lon           float64 // Longitude
	DisplayName   string  // Full human-readable address
	Country       string  // Country name
	CountryCode   string  // ISO 3166-1 alpha-2
	Locality      string  // City / locality
	PrincipalSub  string  // State / province / principal subdivision
	SubLocality   string  // Sub-locality / district
	PostCode      string  // Postal code
	LocalityInfo  map[string]any // Raw locality info from provider
	Provider      Provider // Which provider returned this result
}

// AddressQuery is a structured address query for forward geocoding.
type GeocodeQuery struct {
	Query    string // Free-form query string (e.g. "Eiffel Tower, Paris")
	City     string // City name
	County   string // County name
	State    string // State / province
	Country  string // Country name
	Postcode string // Postal code
	Street   string // Street name
}

// Client is a geocoding client with configurable provider and options.
type Client struct {
	provider  Provider
	userAgent string
	timeout   time.Duration
	http      *http.Client
}

// Option configures a Client.
type Option func(*Client)

// WithProvider sets the geocoding provider.
func WithProvider(p Provider) Option {
	return func(c *Client) { c.provider = p }
}

// WithUserAgent sets the User-Agent header (required by Nominatim).
func WithUserAgent(ua string) Option {
	return func(c *Client) { c.userAgent = ua }
}

// WithTimeout sets the HTTP timeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) { c.timeout = d }
}

// WithHTTPClient sets a custom http.Client.
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) { c.http = h }
}

// NewClient creates a new geocoding client with the given options.
func NewClient(opts ...Option) *Client {
	c := &Client{
		provider:  ProviderNominatim,
		userAgent: defaultUserAgent,
		timeout:   defaultTimeout,
		http:      &http.Client{Timeout: defaultTimeout},
	}
	for _, opt := range opts {
		opt(c)
	}
	if c.http == nil {
		c.http = &http.Client{Timeout: c.timeout}
	} else {
		c.http.Timeout = c.timeout
	}
	return c
}

// ─── Forward Geocoding (address → lat/lon) ─────────────────────

// Forward geocodes a free-form address string to coordinates.
// Uses Nominatim (OpenStreetMap) which is free and requires no API key.
//
// Note: Nominatim has a 1 req/sec rate limit. Cache results for production use.
func Forward(address string) (*GeocodeResult, error) {
	return NewClient().Forward(address)
}

// ForwardStructured geocodes a structured address to coordinates.
func ForwardStructured(q *GeocodeQuery) (*GeocodeResult, error) {
	return NewClient().ForwardStructured(q)
}

// Forward geocodes a free-form address string to coordinates.
func (c *Client) Forward(address string) (*GeocodeResult, error) {
	if strings.TrimSpace(address) == "" {
		return nil, fmt.Errorf("geocode: address is empty")
	}

	params := url.Values{}
	params.Set("q", address)
	params.Set("format", "jsonv2")
	params.Set("addressdetails", "1")
	params.Set("limit", "1")

	return c.nominatimSearch(params)
}

// ForwardStructured geocodes a structured address to coordinates.
func (c *Client) ForwardStructured(q *GeocodeQuery) (*GeocodeResult, error) {
	if q == nil {
		return nil, fmt.Errorf("geocode: query is nil")
	}

	params := url.Values{}
	if q.Query != "" {
		params.Set("q", q.Query)
	} else {
		if q.Street != "" {
			params.Set("street", q.Street)
		}
		if q.City != "" {
			params.Set("city", q.City)
		}
		if q.County != "" {
			params.Set("county", q.County)
		}
		if q.State != "" {
			params.Set("state", q.State)
		}
		if q.Country != "" {
			params.Set("country", q.Country)
		}
		if q.Postcode != "" {
			params.Set("postalcode", q.Postcode)
		}
	}

	if len(params) == 0 {
		return nil, fmt.Errorf("geocode: at least one address field is required")
	}

	params.Set("format", "jsonv2")
	params.Set("addressdetails", "1")
	params.Set("limit", "1")

	return c.nominatimSearch(params)
}

func (c *Client) nominatimSearch(params url.Values) (*GeocodeResult, error) {
	searchURL := fmt.Sprintf("%s/search?%s", nominatimBaseURL, params.Encode())

	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return nil, fmt.Errorf("geocode: create request: %w", err)
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("geocode: nominatim request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("geocode: %s", nominatimRateLimitMsg)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("geocode: nominatim HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("geocode: read response: %w", err)
	}

	var results []nominatimSearchResponse
	if err := json.Unmarshal(body, &results); err != nil {
		return nil, fmt.Errorf("geocode: parse response: %w", err)
	}

	if len(results) == 0 {
		return nil, fmt.Errorf("geocode: no results found")
	}

	return c.parseNominatimResult(&results[0])
}

// ─── Reverse Geocoding (lat/lon → address) ─────────────────────

// Reverse geocodes coordinates to an address.
// Uses Nominatim by default (free, no key, global coverage).
func Reverse(lat, lon float64) (*ReverseResult, error) {
	return NewClient().Reverse(lat, lon)
}

// Reverse geocodes coordinates to an address using the configured provider.
func (c *Client) Reverse(lat, lon float64) (*ReverseResult, error) {
	switch c.provider {
	case ProviderBigDataCloud:
		return c.reverseBigDataCloud(lat, lon)
	default:
		return c.reverseNominatim(lat, lon)
	}
}

// ReverseNominatim reverse geocodes using Nominatim (OpenStreetMap).
// Free, no key, 1 req/sec rate limit, global coverage.
func (c *Client) ReverseNominatim(lat, lon float64) (*ReverseResult, error) {
	return c.reverseNominatim(lat, lon)
}

// ReverseBigDataCloud reverse geocodes using BigDataCloud.
// Free, no key, no rate limit, good for client-side use.
func (c *Client) ReverseBigDataCloud(lat, lon float64) (*ReverseResult, error) {
	return c.reverseBigDataCloud(lat, lon)
}

func (c *Client) reverseNominatim(lat, lon float64) (*ReverseResult, error) {
	params := url.Values{}
	params.Set("lat", strconv.FormatFloat(lat, 'f', -1, 64))
	params.Set("lon", strconv.FormatFloat(lon, 'f', -1, 64))
	params.Set("format", "jsonv2")
	params.Set("addressdetails", "1")
	params.Set("zoom", "18")

	reverseURL := fmt.Sprintf("%s/reverse?%s", nominatimBaseURL, params.Encode())

	req, err := http.NewRequest("GET", reverseURL, nil)
	if err != nil {
		return nil, fmt.Errorf("geocode: create request: %w", err)
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("geocode: nominatim reverse failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("geocode: %s", nominatimRateLimitMsg)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("geocode: nominatim reverse HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("geocode: read response: %w", err)
	}

	var nr nominatimReverseResponse
	if err := json.Unmarshal(body, &nr); err != nil {
		return nil, fmt.Errorf("geocode: parse response: %w", err)
	}

	if nr.Error != nil {
		return nil, fmt.Errorf("geocode: nominatim: %s", nr.Error.Message)
	}

	return &ReverseResult{
		Lat:          lat,
		Lon:          lon,
		DisplayName:  nr.DisplayName,
		Country:      nr.Address.Country,
		CountryCode:  strings.ToUpper(nr.Address.CountryCode),
		PrincipalSub: nr.Address.State,
		Locality:     nr.Address.City,
		PostCode:     nr.Address.Postcode,
		SubLocality:  nr.Address.Suburb,
		LocalityInfo: nr.Address.Extra,
		Provider:     ProviderNominatim,
	}, nil
}

func (c *Client) reverseBigDataCloud(lat, lon float64) (*ReverseResult, error) {
	params := url.Values{}
	params.Set("latitude", strconv.FormatFloat(lat, 'f', -1, 64))
	params.Set("longitude", strconv.FormatFloat(lon, 'f', -1, 64))
	params.Set("localityLanguage", "en")

	requestURL := fmt.Sprintf("%s?%s", bigDataCloudBaseURL, params.Encode())

	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("geocode: create request: %w", err)
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("geocode: bigdatacloud reverse failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("geocode: bigdatacloud HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("geocode: read response: %w", err)
	}

	var bdc bigDataCloudResponse
	if err := json.Unmarshal(body, &bdc); err != nil {
		return nil, fmt.Errorf("geocode: parse response: %w", err)
	}

	return &ReverseResult{
		Lat:          lat,
		Lon:          lon,
		DisplayName:  bdc.Locality,
		Country:      bdc.CountryName,
		CountryCode:  bdc.CountryCode,
		PrincipalSub: bdc.PrincipalSubdivision,
		Locality:     bdc.City,
		SubLocality:  bdc.Locality,
		PostCode:     bdc.Postcode,
		LocalityInfo: bdc.LocalityInfo,
		Provider:     ProviderBigDataCloud,
	}, nil
}

// ─── Distance Calculation ───────────────────────────────────────

// HaversineDistance calculates the great-circle distance between two
// coordinate points in kilometers using the Haversine formula.
func HaversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusKm = 6371.0

	lat1Rad := lat1 * (math.Pi / 180)
	lat2Rad := lat2 * (math.Pi / 180)
	dLat := (lat2 - lat1) * (math.Pi / 180)
	dLon := (lon2 - lon1) * (math.Pi / 180)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusKm * c
}

// HaversineDistanceMeters returns the distance in meters.
func HaversineDistanceMeters(lat1, lon1, lat2, lon2 float64) float64 {
	return HaversineDistance(lat1, lon1, lat2, lon2) * 1000
}

// IsInRadius checks if two coordinates are within a given radius (km).
func IsInRadius(lat1, lon1, lat2, lon2, radiusKm float64) bool {
	return HaversineDistance(lat1, lon1, lat2, lon2) <= radiusKm
}

// ─── Internal types ─────────────────────────────────────────────

// nominatimSearchResponse is the JSON response from Nominatim /search.
type nominatimSearchResponse struct {
	PlaceID     int64                    `json:"place_id"`
	Lat         string                   `json:"lat"`
	Lon         string                   `json:"lon"`
	DisplayName string                   `json:"display_name"`
	Type        string                   `json:"type"`
	Importance  float64                  `json:"importance"`
	Address     nominatimAddress         `json:"address"`
	Extra       map[string]any           `json:"-"` // captured via UnmarshalJSON
}

func (r *nominatimSearchResponse) UnmarshalJSON(data []byte) error {
	type alias nominatimSearchResponse
	var tmp struct {
		alias
		Boundingbox []string `json:"boundingbox"`
	}
	if err := json.Unmarshal(data, &tmp); err != nil {
		return err
	}
	*r = nominatimSearchResponse(tmp.alias)
	return nil
}

// nominatimReverseResponse is the JSON response from Nominatim /reverse.
type nominatimReverseResponse struct {
	PlaceID     int64            `json:"place_id"`
	Lat         string           `json:"lat"`
	Lon         string           `json:"lon"`
	DisplayName string           `json:"display_name"`
	Address     nominatimAddress `json:"address"`
	Error       *nominatimError  `json:"error,omitempty"`
}

type nominatimError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type nominatimAddress struct {
	HouseNumber  string         `json:"house_number"`
	Road         string         `json:"road"`
	Suburb       string         `json:"suburb"`
	City         string         `json:"city"`
	Town         string         `json:"town"`
	Village      string         `json:"village"`
	County       string         `json:"county"`
	State        string         `json:"state"`
	Postcode     string         `json:"postcode"`
	Country      string         `json:"country"`
	CountryCode  string         `json:"country_code"`
	Extra        map[string]any `json:"-"`
}

func (a *nominatimAddress) UnmarshalJSON(data []byte) error {
	// First unmarshal known fields
	type alias nominatimAddress
	var tmp alias
	if err := json.Unmarshal(data, &tmp); err != nil {
		return err
	}
	*a = nominatimAddress(tmp)

	// Then capture extra fields
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err == nil {
		known := map[string]bool{
			"house_number": true, "road": true, "suburb": true,
			"city": true, "town": true, "village": true,
			"county": true, "state": true, "postcode": true,
			"country": true, "country_code": true,
		}
		a.Extra = make(map[string]any)
		for k, v := range raw {
			if !known[k] {
				a.Extra[k] = v
			}
		}
	}
	return nil
}

// bigDataCloudResponse is the JSON response from BigDataCloud reverse geocoding.
type bigDataCloudResponse struct {
	CountryCode        string         `json:"countryCode"`
	CountryName        string         `json:"countryName"`
	PrincipalSubdivision string       `json:"principalSubdivision"`
	Locality           string         `json:"locality"`
	City               string         `json:"city"`
	Postcode           string         `json:"postcode"`
	LocalityInfo       map[string]any `json:"localityInfo"`
}

func (c *Client) parseNominatimResult(r *nominatimSearchResponse) (*GeocodeResult, error) {
	lat, err := strconv.ParseFloat(r.Lat, 64)
	if err != nil {
		return nil, fmt.Errorf("geocode: parse lat %q: %w", r.Lat, err)
	}
	lon, err := strconv.ParseFloat(r.Lon, 64)
	if err != nil {
		return nil, fmt.Errorf("geocode: parse lon %q: %w", r.Lon, err)
	}

	city := r.Address.City
	if city == "" {
		city = r.Address.Town
	}
	if city == "" {
		city = r.Address.Village
	}

	return &GeocodeResult{
		Lat:         lat,
		Lon:         lon,
		DisplayName: r.DisplayName,
		Country:     r.Address.Country,
		CountryCode: strings.ToUpper(r.Address.CountryCode),
		State:       r.Address.State,
		County:      r.Address.County,
		City:        city,
		Postcode:    r.Address.Postcode,
		Street:      r.Address.Road,
		HouseNumber: r.Address.HouseNumber,
		Suburb:      r.Address.Suburb,
		Type:        r.Type,
		Importance:  r.Importance,
		Provider:    ProviderNominatim,
	}, nil
}
