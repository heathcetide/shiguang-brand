// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package videoutil

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// scanProgress reads FFmpeg's -progress pipe:1 output (key=value lines)
// and invokes the callback for each update.
func scanProgress(r io.Reader, last *Progress, cb func(Progress)) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 4096), 256*1024)
	var p Progress
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		idx := strings.IndexByte(line, '=')
		if idx <= 0 {
			continue
		}
		k := line[:idx]
		v := line[idx+1:]
		applyProgressKV(k, v, &p)
		*last = p
		if cb != nil {
			cb(p)
		}
		if p.Done {
			return
		}
	}
}

func applyProgressKV(k, v string, p *Progress) {
	switch k {
	case "frame":
		if n, err := strconv.Atoi(v); err == nil {
			p.Frame = n
		}
	case "fps":
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			p.FPS = f
		}
	case "bitrate":
		p.BitRate = v
	case "speed":
		p.Speed = v
	case "out_time_ms":
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			p.OutTime = time.Duration(n) * time.Microsecond
		}
	case "out_time_us":
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			p.OutTime = time.Duration(n) * time.Microsecond
		}
	case "out_time":
		// "HH:MM:SS.microseconds" format
		if d, err := parseFFmpegDuration(v); err == nil {
			p.OutTime = d
		}
	case "progress":
		p.Done = (v == "end")
	default:
		if p.Extra == nil {
			p.Extra = make(map[string]string)
		}
		p.Extra[k] = v
	}
}

// parseFFmpegDuration parses "HH:MM:SS.fraction" into a time.Duration.
func parseFFmpegDuration(s string) (time.Duration, error) {
	parts := strings.Split(s, ":")
	if len(parts) != 3 {
		return 0, fmt.Errorf("invalid duration: %q", s)
	}
	h, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return 0, err
	}
	m, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return 0, err
	}
	sec, err := strconv.ParseFloat(parts[2], 64)
	if err != nil {
		return 0, err
	}
	total := h*3600 + m*60 + sec
	return time.Duration(total * float64(time.Second)), nil
}

// computePercent estimates completion percentage from the current output
// time and total duration. Returns 0 if total is unknown.
func computePercent(outTime, total time.Duration) float64 {
	if total <= 0 || outTime <= 0 {
		return 0
	}
	pct := float64(outTime) / float64(total) * 100
	if pct > 100 {
		pct = 100
	}
	return pct
}
