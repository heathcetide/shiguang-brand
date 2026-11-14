// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package bootstrap

import (
	"bufio"
	"embed"
	"fmt"
	"strings"
	"sync"
)

//go:embed doom.font
var fontFS embed.FS

var (
	fontOnce  sync.Once
	fontCache map[rune]string
)

// loadDoomFontChars parses the embedded doom.font file and returns a
// map of characters to their ASCII art representation. Results are cached.
//
// File format:
//
//	>> A
//	  ___
//	 / _ \
//	...
//	>> B
//	...
//
// Lines starting with # are comments. ">> space" and ">> dash" map to
// ' ' and '-' respectively; single-char names map to that rune directly.
func loadDoomFontChars() map[rune]string {
	fontOnce.Do(func() {
		fontCache = make(map[rune]string)

		f, err := fontFS.Open("doom.font")
		if err != nil {
			panic(fmt.Sprintf("bootstrap: cannot open embedded doom.font: %v", err))
		}
		defer f.Close()

		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 0, 4096), 64*1024)

		var (
			currentChar  rune
			currentLines []string
			hasChar      bool
		)

		flush := func() {
			if !hasChar {
				return
			}
			fontCache[currentChar] = strings.TrimRight(strings.Join(currentLines, "\n"), "\n")
			currentLines = nil
			hasChar = false
		}

		for scanner.Scan() {
			line := scanner.Text()

			// Skip comments.
			if strings.HasPrefix(line, "#") {
				continue
			}

			// New character entry.
			if strings.HasPrefix(line, ">> ") {
				flush()
				name := strings.TrimSpace(strings.TrimPrefix(line, ">> "))
				ch, ok := fontNameToRune(name)
				if !ok {
					continue
				}
				currentChar = ch
				hasChar = true
				continue
			}

			if hasChar {
				currentLines = append(currentLines, line)
			}
		}
		flush()

		if err := scanner.Err(); err != nil {
			panic(fmt.Sprintf("bootstrap: scan doom.font failed: %v", err))
		}
	})
	return fontCache
}

// fontNameToRune maps a font entry name to its rune.
func fontNameToRune(name string) (rune, bool) {
	switch name {
	case "space":
		return ' ', true
	case "dash":
		return '-', true
	default:
		if len(name) == 1 {
			return rune(name[0]), true
		}
		return 0, false
	}
}
