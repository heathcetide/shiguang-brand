// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package export

import (
	"bufio"
	"encoding/csv"
	"io"
)

// bomStripReader wraps a reader and strips a leading UTF-8 BOM
// (0xEF 0xBB 0xBF) if present.
type bomStripReader struct {
	r       io.Reader
	checked bool
	buf     [3]byte
	buflen  int
}

func (b *bomStripReader) Read(p []byte) (int, error) {
	if !b.checked {
		b.checked = true
		// Peek up to 3 bytes to check for BOM.
		n, err := io.ReadFull(b.r, b.buf[:])
		b.buflen = n
		if err == io.ErrUnexpectedEOF {
			err = nil
		}
		if err != nil {
			if n == 0 {
				return 0, err
			}
		}
		// If the first 3 bytes are the BOM, skip them.
		if n >= 3 && b.buf[0] == 0xEF && b.buf[1] == 0xBB && b.buf[2] == 0xBF {
			b.buflen = 0
		}
	}
	// First drain any buffered bytes from the BOM check.
	if b.buflen > 0 {
		n := copy(p, b.buf[:b.buflen])
		b.buflen -= n
		if b.buflen == 0 && n < len(p) {
			// Continue reading from underlying reader.
			m, err := b.r.Read(p[n:])
			return n + m, err
		}
		return n, nil
	}
	return b.r.Read(p)
}

// newCSVReader creates a csv.Reader with a relaxed field count and a
// large buffer for long lines.
func newCSVReader(r io.Reader) *csv.Reader {
	br := bufio.NewReader(r)
	cr := csv.NewReader(br)
	cr.FieldsPerRecord = -1 // allow variable columns
	cr.ReuseRecord = false
	return cr
}
