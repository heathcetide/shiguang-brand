// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package uaparse provides a lightweight, zero-dependency User-Agent
// parser for HTTP requests. It extracts operating system, browser,
// device type, and rendering engine from a User-Agent string using
// substring matching — fast enough for hot paths and simple enough to
// avoid pulling in a multi-megabyte regex library.
//
// # Quick start
//
//	ua := r.UserAgent()
//	info := uaparse.Parse(ua)
//	fmt.Println(info.OS)       // "macOS"
//	fmt.Println(info.Browser)  // "Chrome"
//	fmt.Println(info.Device)   // "Desktop"
//	fmt.Println(info.Engine)   // "Blink"
//
// # Accuracy
//
// This parser covers the vast majority of real-world traffic
// (Chrome, Firefox, Safari, Edge, Opera, IE, mobile Safari, Android
// browser, bots/crawlers). For exhaustive UA fingerprinting, consider
// a dedicated library like github.com/mssola/user_agent or
// github.com/avct/uasurfer. This package prioritizes speed and
// simplicity over edge-case completeness.
package uaparse

import "strings"

// ──────────────────────────────────────────────
// Info
// ──────────────────────────────────────────────

// Info holds the parsed components of a User-Agent string.
type Info struct {
	// OS is the operating system family: "Windows", "macOS", "Linux",
	// "Android", "iOS", "ChromeOS", "Unknown".
	OS string

	// OSVersion is the OS version if detectable, otherwise "".
	OSVersion string

	// Browser is the browser family: "Chrome", "Firefox", "Safari",
	// "Edge", "Opera", "IE", "Unknown".
	Browser string

	// BrowserVersion is the browser version if detectable, otherwise "".
	BrowserVersion string

	// Device is the device class: "Desktop", "Mobile", "Tablet",
	// "Bot", "Unknown".
	Device string

	// Engine is the rendering engine: "Blink", "Gecko", "WebKit",
	// "Trident", "Unknown".
	Engine string

	// IsBot reports whether the UA string matches known bot/crawler
	// patterns.
	IsBot bool
}

// ──────────────────────────────────────────────
// Parse
// ──────────────────────────────────────────────

// Parse extracts OS, browser, device, and engine from a User-Agent
// string. Returns a zero-value Info if ua is empty.
func Parse(ua string) Info {
	var info Info
	if ua == "" {
		return info
	}
	uaLower := strings.ToLower(ua)

	info.IsBot = detectBot(uaLower)
	info.OS, info.OSVersion = detectOS(ua, uaLower)
	info.Browser, info.BrowserVersion = detectBrowser(ua, uaLower)
	info.Device = detectDevice(uaLower, info.OS, info.IsBot)
	info.Engine = detectEngine(uaLower, info.Browser)

	return info
}

// ──────────────────────────────────────────────
// Bot detection
// ──────────────────────────────────────────────

var botPatterns = []string{
	"bot", "crawler", "spider", "scraper", "slurp",
	"facebookexternalhit", "twitterbot", "linkedinbot",
	"whatsapp", "telegrambot", "yandex", "bingpreview",
	"googlebot", "baiduspider", "sogou", "exabot",
	"applebot", "duckduckbot", "ia_archiver", "archive.org_bot",
	"semrush", "ahrefsbot", "mj12bot", "dotbot",
}

func detectBot(uaLower string) bool {
	for _, p := range botPatterns {
		if strings.Contains(uaLower, p) {
			return true
		}
	}
	return false
}

// ──────────────────────────────────────────────
// OS detection
// ──────────────────────────────────────────────

func detectOS(ua, uaLower string) (os, version string) {
	switch {
	case strings.Contains(uaLower, "windows nt"):
		os = "Windows"
		version = extractWindowsVersion(uaLower)
	case strings.Contains(uaLower, "android"):
		os = "Android"
		version = extractVersionAfter(ua, "Android")
	case strings.Contains(uaLower, "iphone") || strings.Contains(uaLower, "ipad") || strings.Contains(uaLower, "ios"):
		os = "iOS"
		version = extractIOSVersion(ua, uaLower)
	case strings.Contains(uaLower, "mac os x") || strings.Contains(uaLower, "macintosh"):
		os = "macOS"
		version = extractMacOSVersion(ua, uaLower)
	case strings.Contains(uaLower, "cros"):
		os = "ChromeOS"
	case strings.Contains(uaLower, "linux") || strings.Contains(uaLower, "x11"):
		os = "Linux"
	default:
		os = "Unknown"
	}
	return
}

func extractWindowsVersion(uaLower string) string {
	switch {
	case strings.Contains(uaLower, "windows nt 10.0"):
		return "10"
	case strings.Contains(uaLower, "windows nt 6.3"):
		return "8.1"
	case strings.Contains(uaLower, "windows nt 6.2"):
		return "8"
	case strings.Contains(uaLower, "windows nt 6.1"):
		return "7"
	case strings.Contains(uaLower, "windows nt 6.0"):
		return "Vista"
	case strings.Contains(uaLower, "windows nt 5.1"):
		return "XP"
	default:
		return ""
	}
}

func extractMacOSVersion(ua, uaLower string) string {
	// "Mac OS X 10_15_7" or "Mac OS X 10.15.7"
	idx := strings.Index(uaLower, "mac os x ")
	if idx < 0 {
		return ""
	}
	rest := ua[idx+9:] // len("mac os x ") = 9
	return parseVersionString(rest)
}

func extractIOSVersion(ua, uaLower string) string {
	// "CPU iPhone OS 17_2 like Mac OS X" or "CPU OS 17_2 like Mac OS X"
	// Look for "OS " followed by version, but skip "Mac OS X".
	idx := indexOfCI(ua, "iPhone OS ")
	if idx >= 0 {
		return parseVersionString(ua[idx+10:])
	}
	idx = indexOfCI(ua, "CPU OS ")
	if idx >= 0 {
		return parseVersionString(ua[idx+7:])
	}
	return ""
}

// ──────────────────────────────────────────────
// Browser detection
// ──────────────────────────────────────────────

func detectBrowser(ua, uaLower string) (browser, version string) {
	// Order matters: Edge and Opera must be checked before Chrome
	// because they contain "Chrome" in their UA string.
	switch {
	case strings.Contains(uaLower, "edg/"):
		browser = "Edge"
		version = extractVersionAfter(ua, "Edg/")
	case strings.Contains(uaLower, "opera") || strings.Contains(uaLower, "opr/"):
		browser = "Opera"
		if strings.Contains(uaLower, "opr/") {
			version = extractVersionAfter(ua, "OPR/")
		} else {
			version = extractVersionAfter(ua, "Opera/")
		}
	case strings.Contains(uaLower, "samsungbrowser"):
		browser = "Samsung Browser"
		version = extractVersionAfter(ua, "SamsungBrowser/")
	case strings.Contains(uaLower, "firefox/"):
		browser = "Firefox"
		version = extractVersionAfter(ua, "Firefox/")
	case strings.Contains(uaLower, "chrome/"):
		browser = "Chrome"
		version = extractVersionAfter(ua, "Chrome/")
	case strings.Contains(uaLower, "crios/"):
		browser = "Chrome"
		version = extractVersionAfter(ua, "CriOS/")
	case strings.Contains(uaLower, "fxios/"):
		browser = "Firefox"
		version = extractVersionAfter(ua, "FxiOS/")
	case strings.Contains(uaLower, "version/") && strings.Contains(uaLower, "safari"):
		// Safari on iOS/macOS uses "Version/X.Y.Z Safari/"
		browser = "Safari"
		version = extractVersionAfter(ua, "Version/")
	case strings.Contains(uaLower, "safari/"):
		// Safari without Version/ header (older)
		browser = "Safari"
		version = extractVersionAfter(ua, "Safari/")
	case strings.Contains(uaLower, "msie ") || strings.Contains(uaLower, "trident/"):
		browser = "IE"
		if strings.Contains(uaLower, "msie ") {
			version = extractVersionAfter(ua, "MSIE ")
		} else {
			version = extractVersionAfter(ua, "rv:")
	}
	default:
		browser = "Unknown"
	}
	return
}

// ──────────────────────────────────────────────
// Device detection
// ──────────────────────────────────────────────

func detectDevice(uaLower, os string, isBot bool) string {
	if isBot {
		return "Bot"
	}
	switch {
	case strings.Contains(uaLower, "ipad"):
		return "Tablet"
	case strings.Contains(uaLower, "tablet"):
		return "Tablet"
	case strings.Contains(uaLower, "mobile") || strings.Contains(uaLower, "iphone") || strings.Contains(uaLower, "android"):
		// Android tablets often don't have "mobile" in UA.
		if os == "Android" && !strings.Contains(uaLower, "mobile") {
			return "Tablet"
		}
		return "Mobile"
	case strings.Contains(uaLower, "playstation") || strings.Contains(uaLower, "xbox") || strings.Contains(uaLower, "nintendo"):
		return "Console"
	default:
		return "Desktop"
	}
}

// ──────────────────────────────────────────────
// Engine detection
// ──────────────────────────────────────────────

func detectEngine(uaLower, browser string) string {
	switch {
	case browser == "IE":
		return "Trident"
	case browser == "Firefox":
		return "Gecko"
	case strings.Contains(uaLower, "gecko/") && !strings.Contains(uaLower, "chrome"):
		return "Gecko"
	case strings.Contains(uaLower, "applewebkit/") && strings.Contains(uaLower, "chrome"):
		return "Blink"
	case strings.Contains(uaLower, "applewebkit/"):
		return "WebKit"
	case browser == "Edge":
		return "Blink"
	case browser == "Opera":
		return "Blink"
	case browser == "Chrome":
		return "Blink"
	default:
		return "Unknown"
	}
}

// ──────────────────────────────────────────────
// Version extraction helpers
// ──────────────────────────────────────────────

// extractVersionAfter finds the substring after marker and parses the
// leading version-like characters (digits and dots).
func extractVersionAfter(ua, marker string) string {
	// Case-insensitive search.
	idx := indexOfCI(ua, marker)
	if idx < 0 {
		return ""
	}
	rest := ua[idx+len(marker):]
	return parseVersionString(rest)
}

// indexOfCI is a case-insensitive strings.Index.
func indexOfCI(s, substr string) int {
	sLower := strings.ToLower(s)
	subLower := strings.ToLower(substr)
	return strings.Index(sLower, subLower)
}

// parseVersionString extracts the leading "N.N.N[.N]" portion of s,
// stopping at the first non-version character. Allows up to 4
// numeric segments (e.g. Chrome's "120.0.0.0").
func parseVersionString(s string) string {
	var b strings.Builder
	dotCount := 0
	for i, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		} else if r == '.' || r == '_' {
			// Stop after a separator that is followed by a non-digit
			// (e.g. "10_15_7)" → "10.15.7").
			if i+1 < len(s) && (s[i+1] < '0' || s[i+1] > '9') {
				break
			}
			b.WriteRune('.')
			dotCount++
			if dotCount >= 4 {
				break
			}
		} else {
			break
		}
	}
	return strings.TrimSuffix(b.String(), ".")
}
