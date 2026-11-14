// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package phone

import (
	"regexp"
	"strings"
)

var phoneDigitsOnly = regexp.MustCompile(`\D`)

// NormalizePhoneDigits strips non-digits from a phone number string.
func NormalizePhoneDigits(number string) string {
	return phoneDigitsOnly.ReplaceAllString(strings.TrimSpace(number), "")
}

// FormatPhoneLocation builds UI text like 四川成都(中国移动).
// When province and city are the same (e.g. 上海/上海), only one is shown.
func FormatPhoneLocation(province, city, cardType string) string {
	province = strings.TrimSpace(province)
	city = strings.TrimSpace(city)
	cardType = strings.TrimSpace(cardType)
	province = strings.TrimSuffix(province, "省")
	city = strings.TrimSuffix(city, "市")
	loc := province
	if city != "" && city != province {
		if loc != "" {
			loc += city
		} else {
			loc = city
		}
	} else if loc == "" {
		loc = city
	}
	if loc == "" {
		return ""
	}
	if cardType == "" {
		return loc
	}
	return loc + "(" + cardType + ")"
}

// LookupPhoneLocationParts returns normalized (province, city, cardType) parts
// for stats. Empty strings mean lookup failed or number is too short.
func LookupPhoneLocationParts(number string) (province, city, cardType string) {
	digits := NormalizePhoneDigits(number)
	if len(digits) < 7 {
		return "", "", ""
	}
	pr, err := Find(digits)
	if err != nil || pr == nil {
		return "", "", ""
	}
	province = strings.TrimSpace(pr.Province)
	city = strings.TrimSpace(pr.City)
	cardType = strings.TrimSpace(pr.CardType)
	province = strings.TrimSuffix(province, "省")
	city = strings.TrimSuffix(city, "市")
	return province, city, cardType
}

// LookupPhoneLocation resolves mainland mobile/landline segment data for number.
// Returns empty string when lookup fails or number is too short.
func LookupPhoneLocation(number string) string {
	province, city, cardType := LookupPhoneLocationParts(number)
	return FormatPhoneLocation(province, city, cardType)
}
