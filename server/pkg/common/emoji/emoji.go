// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package emoji converts between emoji shortcodes and Unicode, and detects /
// strips emoji in strings.
//
// # Quick start
//
//	emoji.ShortcodeToUnicode(":smile:")   // "😄"
//	emoji.UnicodeToShortcode("😄")        // ":smile:"
//	emoji.RemoveEmoji("hi 😄!")           // "hi !"
//	emoji.ContainsEmoji("hi 😄")          // true
//	emoji.CountEmoji("a😄b😎c")           // 2
package emoji

import (
	"strings"
)

// emojiMap maps shortcode (without colons) to the Unicode emoji string.
var emojiMap = map[string]string{
	"smile":            "😄",
	"laughing":         "😆",
	"grinning":         "😀",
	"smiley":           "😃",
	"sunglasses":       "😎",
	"sweat_smile":      "😅",
	"rofl":             "🤣",
	"joy":              "😂",
	"wink":             "😉",
	"blush":            "😊",
	"heart_eyes":       "😍",
	"kissing_heart":    "😘",
	"kissing":          "😗",
	"relaxed":          "☺️",
	"slight_smile":     "🙂",
	"hugging":          "🤗",
	"thinking":         "🤔",
	"neutral_face":     "😐",
	"expressionless":   "😑",
	"unamused":         "😒",
	"rolling_eyes":     "🙄",
	"smirk":            "😏",
	"persevere":        "😣",
	"disappointed":     "😞",
	"worried":          "😟",
	"angry":            "😠",
	"rage":             "😡",
	"pensive":          "😔",
	"confused":         "😕",
	"flushed":          "😳",
	"frowning":         "😦",
	"anguished":        "😧",
	"open_mouth":       "😮",
	"astonished":       "😲",
	"dizzy_face":       "😵",
	"scream":           "😱",
	"fearful":          "😨",
	"cold_sweat":       "😰",
	"cry":              "😢",
	"sob":              "😭",
	"kiss":             "💋",
	"thumbsup":         "👍",
	"thumbsdown":       "👎",
	"ok_hand":          "👌",
	"v":                "✌️",
	"raised_hand":      "✋",
	"clap":             "👏",
	"wave":             "👋",
	"handshake":        "🤝",
	"pray":             "🙏",
	"muscle":           "💪",
	"point_up":         "☝️",
	"point_down":       "👇",
	"point_left":       "👈",
	"point_right":      "👉",
	"heart":            "❤️",
	"orange_heart":     "🧡",
	"yellow_heart":     "💛",
	"green_heart":      "💚",
	"blue_heart":       "💙",
	"purple_heart":     "💜",
	"broken_heart":     "💔",
	"two_hearts":       "💕",
	"sparkling_heart":  "💖",
	"fire":             "🔥",
	"star":             "⭐",
	"star2":            "🌟",
	"sparkles":         "✨",
	"boom":             "💥",
	"sunny":            "☀️",
	"cloud":            "☁️",
	"umbrella":         "☂️",
	"snowflake":        "❄️",
	"coffee":           "☕",
	"tea":              "🍵",
	"beer":             "🍺",
	"wine_glass":       "🍷",
	"cake":             "🍰",
	"pizza":            "🍕",
	"burger":           "🍔",
	"apple":            "🍎",
	"banana":           "🍌",
	"tada":             "🎉",
	"balloon":          "🎈",
	"gift":             "🎁",
	"100":              "💯",
	"checkered_flag":   "🏁",
	"rocket":           "🚀",
	"car":              "🚗",
	"airplane":         "✈️",
	"house":            "🏠",
	"office":           "🏢",
	"school":           "🏫",
	"hospital":         "🏥",
	"dog":              "🐶",
	"cat":              "🐱",
	"mouse":            "🐭",
	"hamster":          "🐹",
	"rabbit":           "🐰",
	"fox":              "🦊",
	"bear":             "🐻",
	"panda":            "🐼",
	"koala":            "🐨",
	"tiger":            "🐯",
	"lion":             "🦁",
	"cow":              "🐮",
	"pig":              "🐷",
	"frog":             "🐸",
	"monkey":           "🐵",
	"chicken":          "🐔",
	"penguin":          "🐧",
	"bird":             "🐦",
	"turtle":           "🐢",
	"snake":            "🐍",
	"whale":            "🐳",
	"dolphin":          "🐬",
	"fish":             "🐟",
	"octopus":          "🐙",
	"shell":            "🐚",
	"snail":            "🐌",
	"bug":              "🐛",
	"ant":              "🐜",
	"honeybee":         "🐝",
	"ladybug":          "🐞",
}

// unicodeToShortcodeMap is the reverse of emojiMap, built lazily.
var unicodeToShortcodeMap map[string]string

// firstRuneIndex maps the first rune of each emoji to the list of shortcode
// names whose emoji begins with that rune, enabling efficient prefix matching
// for multi-rune emoji (e.g. "❤️" = U+2764 + U+FE0F).
var firstRuneIndex map[rune][]string

// maxEmojiRunes is the maximum rune length of any emoji in the map.
var maxEmojiRunes int

func init() {
	unicodeToShortcodeMap = make(map[string]string, len(emojiMap))
	firstRuneIndex = make(map[rune][]string)
	for code, uni := range emojiMap {
		// If multiple shortcodes map to the same unicode, keep the first seen.
		if _, ok := unicodeToShortcodeMap[uni]; !ok {
			unicodeToShortcodeMap[uni] = code
		}
		runes := []rune(uni)
		if len(runes) > maxEmojiRunes {
			maxEmojiRunes = len(runes)
		}
		firstRuneIndex[runes[0]] = append(firstRuneIndex[runes[0]], code)
	}
}

// ShortcodeToUnicode replaces :shortcode: occurrences in s with their Unicode
// emoji. Unknown shortcodes are left untouched.
func ShortcodeToUnicode(s string) string {
	var b strings.Builder
	i := 0
	for i < len(s) {
		if s[i] != ':' {
			b.WriteByte(s[i])
			i++
			continue
		}
		// Find the closing colon.
		end := strings.IndexByte(s[i+1:], ':')
		if end < 0 {
			b.WriteString(s[i:])
			break
		}
		name := s[i+1 : i+1+end]
		if uni, ok := emojiMap[name]; ok {
			b.WriteString(uni)
		} else {
			// Unknown shortcode: keep it verbatim including colons.
			b.WriteString(s[i : i+1+end+1])
		}
		i = i + 1 + end + 1
	}
	return b.String()
}

// UnicodeToShortcode replaces known emoji in s with their :shortcode: form.
func UnicodeToShortcode(s string) string {
	var b strings.Builder
	runes := []rune(s)
	i := 0
	for i < len(runes) {
		if n, code, ok := matchEmojiAt2(runes, i); ok {
			b.WriteByte(':')
			b.WriteString(code)
			b.WriteByte(':')
			i += n
		} else {
			b.WriteRune(runes[i])
			i++
		}
	}
	return b.String()
}

// RemoveEmoji strips all known emoji from s.
func RemoveEmoji(s string) string {
	var b strings.Builder
	runes := []rune(s)
	i := 0
	for i < len(runes) {
		if n, _, ok := matchEmojiAt2(runes, i); ok {
			i += n
		} else {
			b.WriteRune(runes[i])
			i++
		}
	}
	return b.String()
}

// matchEmojiAt2 is a helper returning the matched shortcode and its rune length.
func matchEmojiAt2(runes []rune, i int) (int, string, bool) {
	if i >= len(runes) {
		return 0, "", false
	}
	candidates, ok := firstRuneIndex[runes[i]]
	if !ok {
		return 0, "", false
	}
	limit := maxEmojiRunes
	if len(runes)-i < limit {
		limit = len(runes) - i
	}
	for n := limit; n >= 1; n-- {
		cand := string(runes[i : i+n])
		for _, code := range candidates {
			if emojiMap[code] == cand {
				return n, code, true
			}
		}
	}
	return 0, "", false
}

// ContainsEmoji reports whether s contains at least one known emoji.
func ContainsEmoji(s string) bool {
	runes := []rune(s)
	for i := 0; i < len(runes); i++ {
		if _, _, ok := matchEmojiAt2(runes, i); ok {
			return true
		}
	}
	return false
}

// CountEmoji returns the number of known emoji in s (each multi-rune emoji
// counts once).
func CountEmoji(s string) int {
	count := 0
	runes := []rune(s)
	i := 0
	for i < len(runes) {
		if n, _, ok := matchEmojiAt2(runes, i); ok {
			count++
			i += n
		} else {
			i++
		}
	}
	return count
}
