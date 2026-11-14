// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package memory

// extractDateFromKey extracts "YYYY-MM-DD" from a key string.
func extractDateFromKey(key string) string {
	for i := 0; i <= len(key)-10; i++ {
		if isDigit(key[i]) && isDigit(key[i+1]) && isDigit(key[i+2]) && isDigit(key[i+3]) &&
			key[i+4] == '-' &&
			isDigit(key[i+5]) && isDigit(key[i+6]) &&
			key[i+7] == '-' &&
			isDigit(key[i+8]) && isDigit(key[i+9]) {
			return key[i : i+10]
		}
	}
	return ""
}
