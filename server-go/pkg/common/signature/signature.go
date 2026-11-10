// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package signature provides request signing and verification utilities.
//
// It offers HMAC-SHA256/SHA512 signing, MD5 signing (for legacy systems),
// and HTTP request signing following a standard flow:
//
//	method + url + sorted query params + body + timestamp
//
// The WeChat/Alipay-style sorted-params signing is also supported.
//
// # Quick start
//
//	sig := signature.SignHMACSHA256("data", []byte("secret"))
//	signature.VerifyHMACSHA256("data", []byte("secret"), sig)
//	signature.SignMD5("hello")
//	signature.SignSortedParams(params, "key")
package signature

import (
	"crypto/hmac"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/hash"
)

// SignHMACSHA256 returns the hex-encoded HMAC-SHA256 of data keyed by key.
func SignHMACSHA256(data string, key []byte) string {
	return hash.HMACSHA256Hex([]byte(data), key)
}

// VerifyHMACSHA256 reports whether sig is a valid HMAC-SHA256 of data keyed by
// key. The comparison is constant-time.
func VerifyHMACSHA256(data string, key []byte, sig string) bool {
	expected := SignHMACSHA256(data, key)
	return hash.HMACEqual([]byte(expected), []byte(sig))
}

// SignHMACSHA512 returns the hex-encoded HMAC-SHA512 of data keyed by key.
func SignHMACSHA512(data string, key []byte) string {
	return hash.HMACSHA512Hex([]byte(data), key)
}

// VerifyHMACSHA512 reports whether sig is a valid HMAC-SHA512 of data keyed by
// key. The comparison is constant-time.
func VerifyHMACSHA512(data string, key []byte, sig string) bool {
	expected := SignHMACSHA512(data, key)
	return hash.HMACEqual([]byte(expected), []byte(sig))
}

// SignMD5 returns the hex-encoded MD5 of data. MD5 is cryptographically broken
// and should only be used for compatibility with legacy systems.
func SignMD5(data string) string {
	return hash.MD5String(data)
}

// SignRequest signs an HTTP request following the standard flow:
//
//	{method}\n{url}\n{sorted params}\n{body}\n{timestamp}
//
// where sorted params is the query parameters sorted by key and joined as
// key=value&key=value. The timestamp is the current Unix time in seconds.
func SignRequest(method, urlStr string, params url.Values, body []byte, key []byte) string {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	return signRequestAt(method, urlStr, params, body, key, timestamp)
}

// signRequestAt builds the canonical payload and returns the HMAC-SHA256
// signature using the provided timestamp.
func signRequestAt(method, urlStr string, params url.Values, body []byte, key []byte, timestamp string) string {
	payload := buildRequestPayload(method, urlStr, params, body, timestamp)
	return SignHMACSHA256(payload, key)
}

// buildRequestPayload constructs the canonical string that is signed.
func buildRequestPayload(method, urlStr string, params url.Values, body []byte, timestamp string) string {
	var b strings.Builder
	b.WriteString(method)
	b.WriteByte('\n')
	b.WriteString(urlStr)
	b.WriteByte('\n')
	b.WriteString(sortedParamsString(params))
	b.WriteByte('\n')
	b.Write(body)
	b.WriteByte('\n')
	b.WriteString(timestamp)
	return b.String()
}

// VerifyRequest verifies a request signature and ensures the timestamp is
// within maxAge of the current time. A non-positive maxAge disables the
// freshness check.
func VerifyRequest(method, urlStr string, params url.Values, body []byte, key []byte, sig string, maxAge time.Duration) bool {
	// The timestamp must be supplied as the "timestamp" query parameter.
	ts := params.Get("timestamp")
	if ts == "" {
		return false
	}
	if maxAge > 0 {
		tsInt, err := strconv.ParseInt(ts, 10, 64)
		if err != nil {
			return false
		}
		if time.Since(time.Unix(tsInt, 0)) > maxAge {
			return false
		}
	}
	expected := signRequestAt(method, urlStr, params, body, key, ts)
	return hmac.Equal([]byte(expected), []byte(sig))
}

// SignSortedParams implements WeChat/Alipay-style parameter signing: the
// parameters are sorted by key, joined as key=value&key=value, the key is
// appended, and the MD5 of the result is returned (upper-case hex).
func SignSortedParams(params url.Values, key string) string {
	raw := sortedParamsString(params) + key
	sum := md5.Sum([]byte(raw))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

// sortedParamsString returns the params sorted by key and joined as
// key=value&key=value. Empty values are skipped.
func sortedParamsString(params url.Values) string {
	if params == nil {
		return ""
	}
	keys := make([]string, 0, len(params))
	for k, vs := range params {
		if k == "sign" {
			continue
		}
		for _, v := range vs {
			if v == "" {
				continue
			}
			keys = append(keys, fmt.Sprintf("%s=%s", k, v))
		}
	}
	sort.Strings(keys)
	return strings.Join(keys, "&")
}
