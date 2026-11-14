// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package geoip provides IP geolocation lookup utilities.
//
// It automatically selects between a domestic (China) API
// (whois.pconline.com.cn) and an international API (ip-api.com) based on
// the IP address, and also exposes explicit CN/Global variants.
//
// # Quick start
//
//	country, city, location, err := geoip.GetIPLocation("8.8.8.8")
//	// → "United States", "Mountain View", "Mountain View, United States", nil
//
//	// Force domestic API (more accurate for China IPs)
//	country, city, location, _ := geoip.GetIPLocationCN("112.0.0.1")
//
//	// Just the display string
//	addr := geoip.GetRealAddressByIP("8.8.8.8")
package geoip

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// Constants for unknown/internal labels.
const (
	PCONLINE_IP_URL = "http://whois.pconline.com.cn/ipJson.jsp"
	IP_API_URL      = "http://ip-api.com/json/"
	UNKNOWN         = "Unknown"
	INTERNAL_IP     = "内网IP"
	LOCAL_NETWORK   = "Local Network"
)

// LocalNetwork is the display label for internal/private client IPs.
const LocalNetwork = LOCAL_NETWORK

// IPLocationResponse IP 地理位置查询响应（pconline 格式）
type IPLocationResponse struct {
	Pro  string `json:"pro"`
	City string `json:"city"`
}

// IPGeolocationResponse IP 地理位置 API 响应（ip-api 格式）
type IPGeolocationResponse struct {
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	RegionName  string  `json:"regionName"`
	City        string  `json:"city"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	Timezone    string  `json:"timezone"`
	ISP         string  `json:"isp"`
	Org         string  `json:"org"`
	AS          string  `json:"as"`
	Query       string  `json:"query"`
	Status      string  `json:"status"`
	Message     string  `json:"message"`
}

// IsIP returns true if s is a valid IP address.
func IsIP(s string) bool {
	return net.ParseIP(s) != nil
}

// ParseIP parses s into a net.IP, returning nil on failure.
func ParseIP(s string) net.IP {
	return net.ParseIP(s)
}

// IsPrivateIP returns true if ip is in a private/loopback/link-local range.
func IsPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	private := []net.IPNet{
		{IP: net.IPv4(10, 0, 0, 0), Mask: net.CIDRMask(8, 32)},
		{IP: net.IPv4(172, 16, 0, 0), Mask: net.CIDRMask(12, 32)},
		{IP: net.IPv4(192, 168, 0, 0), Mask: net.CIDRMask(16, 32)},
	}
	for _, p := range private {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// IsIpInCIDRList checks whether ip is contained in any of the given CIDR
// entries. Entries that are not valid CIDR notation are treated as
// individual IPs.
func IsIpInCIDRList(ip net.IP, cidrList []string) bool {
	for _, cidr := range cidrList {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			if wip := net.ParseIP(cidr); wip != nil && ip.Equal(wip) {
				return true
			}
			continue
		}
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// IsInternalIP returns true if ipStr is an internal/private address.
func IsInternalIP(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}

// GetIPLocation resolves the geographic location of an IP address.
// It automatically selects a domestic (China) or international API.
// Returns country, city, full location string, and error.
func GetIPLocation(ip string) (string, string, string, error) {
	if IsInternalIP(ip) || ip == "127.0.0.1" || ip == "::1" || ip == "localhost" {
		return "Local", "Local", LOCAL_NETWORK, nil
	}
	if isChinaIP(ip) {
		country, city, loc, err := getIPLocationFromPconline(ip)
		if err == nil && country != UNKNOWN {
			return country, city, loc, nil
		}
		return getIPLocationFromIPAPI(ip)
	}
	return getIPLocationFromIPAPI(ip)
}

// GetIPLocationCN forces the domestic (China) API for lookup.
func GetIPLocationCN(ip string) (string, string, string, error) {
	if IsInternalIP(ip) {
		return "Local", "Local", LOCAL_NETWORK, nil
	}
	country, city, loc, err := getIPLocationFromPconline(ip)
	if err == nil && country != UNKNOWN {
		return country, city, loc, nil
	}
	return getIPLocationFromIPAPI(ip)
}

// GetIPLocationGlobal forces the international API for lookup.
func GetIPLocationGlobal(ip string) (string, string, string, error) {
	if IsInternalIP(ip) {
		return "Local", "Local", LOCAL_NETWORK, nil
	}
	return getIPLocationFromIPAPI(ip)
}

// GetRealAddressByIP returns a single display string for the IP location.
func GetRealAddressByIP(ip string) string {
	if IsInternalIP(ip) {
		return INTERNAL_IP
	}
	_, _, loc, _ := GetIPLocation(ip)
	if loc == "" || loc == UNKNOWN {
		return UNKNOWN
	}
	return loc
}

// isChinaIP performs a simple prefix-based check for China IP ranges.
func isChinaIP(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil || !parsed.IsGlobalUnicast() {
		return false
	}
	prefixes := []string{"112.", "113.", "115.", "116.", "117.", "118.", "119.", "120.", "183.", "223."}
	for _, p := range prefixes {
		if strings.HasPrefix(ip, p) {
			return true
		}
	}
	return false
}

func getIPLocationFromPconline(ip string) (string, string, string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	url := fmt.Sprintf("%s?ip=%s&json=true", PCONLINE_IP_URL, ip)
	resp, err := client.Get(url)
	if err != nil {
		return UNKNOWN, UNKNOWN, UNKNOWN, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return UNKNOWN, UNKNOWN, UNKNOWN, fmt.Errorf("http status: %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	var loc IPLocationResponse
	if err := json.Unmarshal(body, &loc); err != nil {
		return UNKNOWN, UNKNOWN, UNKNOWN, err
	}
	pro := strings.TrimSpace(loc.Pro)
	city := strings.TrimSpace(loc.City)
	if pro == "" {
		pro = UNKNOWN
	}
	if city == "" {
		city = UNKNOWN
	}
	return "中国", city, fmt.Sprintf("%s %s", pro, city), nil
}

func getIPLocationFromIPAPI(ip string) (string, string, string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	url := fmt.Sprintf("%s%s?fields=status,message,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,query", IP_API_URL, ip)
	resp, err := client.Get(url)
	if err != nil {
		return UNKNOWN, UNKNOWN, UNKNOWN, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var geo IPGeolocationResponse
	if err := json.Unmarshal(body, &geo); err != nil {
		return UNKNOWN, UNKNOWN, UNKNOWN, err
	}
	if geo.Status == "fail" {
		return UNKNOWN, UNKNOWN, UNKNOWN, fmt.Errorf("%s", geo.Message)
	}
	country := geo.Country
	city := geo.City
	if country == "" {
		country = UNKNOWN
	}
	if city == "" {
		city = UNKNOWN
	}
	return country, city, fmt.Sprintf("%s, %s", city, country), nil
}
