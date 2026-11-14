// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package bootstrap provides application startup utilities inspired by
// Java Spring Boot: banner printing, lifecycle management, component
// registry, profile-based configuration, event publishing, and graceful
// shutdown.
//
// Basic usage:
//
//	app := bootstrap.New("myapp").
//	    Profile(bootstrap.ProfileDev).
//	    BannerText("MyApp").
//	    Register("db", &DatabaseComponent{}).
//	    Register("cache", &CacheComponent{})
//	app.Run() // blocks until shutdown signal
package bootstrap

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/constants"
)

// GenerateBannerWithDoomFont generates ASCII art banner using Doom font and
// saves to file. It tries an online figlet API first, falling back to a
// local Doom font implementation.
func GenerateBannerWithDoomFont(text, filename string) error {
	banner, err := generateBannerFromAPI(text)
	if err != nil {
		fmt.Printf("API call failed, using local Doom font implementation: %v\n", err)
		banner, err = generateBannerWithLocalDoom(text)
		if err != nil {
			return fmt.Errorf("failed to generate banner: %w", err)
		}
	}
	return os.WriteFile(filename, []byte(banner), constants.BannerFilePerm)
}

// generateBannerFromAPI tries to generate banner using online figlet API.
func generateBannerFromAPI(text string) (string, error) {
	encodedText := url.QueryEscape(text)
	apiURL := fmt.Sprintf(constants.BannerAPIURLTemplate, encodedText)

	client := &http.Client{
		Timeout: constants.BannerAPITimeout,
	}

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", constants.BannerUserAgent)
	req.Header.Set("Accept", constants.BannerAcceptHeader)
	req.Header.Set("Referer", constants.BannerRefererURL)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("API returned status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	bodyStr := string(body)
	if strings.Contains(bodyStr, constants.HTMLDoctypePrefix) ||
		strings.Contains(bodyStr, constants.HTMLTagPrefix) ||
		strings.Contains(bodyStr, constants.HTML404Error) {
		return "", fmt.Errorf("API returned HTML error page instead of ASCII art")
	}
	banner := strings.TrimSpace(bodyStr)
	if banner == "" {
		return "", fmt.Errorf("empty response from API")
	}
	banner = strings.ReplaceAll(banner, constants.HTMLBrTag, "\n")
	banner = strings.ReplaceAll(banner, constants.HTMLBrSelfClose, "\n")
	banner = strings.ReplaceAll(banner, constants.HTMLBrCloseSpace, "\n")
	if !strings.ContainsAny(banner, constants.ASCIIArtChars) {
		return "", fmt.Errorf("API response doesn't appear to be ASCII art")
	}
	return banner, nil
}

// generateBannerWithLocalDoom generates banner using local Doom font implementation.
func generateBannerWithLocalDoom(text string) (string, error) {
	doomChars := loadDoomFontChars()
	text = strings.ToUpper(text)
	lines := make([]string, constants.DoomFontHeight)
	for _, char := range text {
		if charArt, ok := doomChars[char]; ok {
			charLines := strings.Split(charArt, "\n")
			for len(charLines) > 0 && strings.TrimSpace(charLines[len(charLines)-1]) == "" {
				charLines = charLines[:len(charLines)-1]
			}
			maxWidth := 0
			for _, line := range charLines {
				if len(line) > maxWidth {
					maxWidth = len(line)
				}
			}
			for i := 0; i < constants.DoomFontHeight; i++ {
				if i < len(charLines) {
					paddedLine := charLines[i]
					for len(paddedLine) < maxWidth {
						paddedLine += " "
					}
					lines[i] += paddedLine
				} else {
					lines[i] += strings.Repeat(" ", maxWidth)
				}
			}
		} else if char == ' ' {
			for i := 0; i < constants.DoomFontHeight; i++ {
				lines[i] += strings.Repeat(" ", constants.DoomFontSpaceWidth)
			}
		} else {
			for i := 0; i < constants.DoomFontHeight; i++ {
				lines[i] += constants.DoomFontUnknownChar
			}
		}
	}
	result := strings.Join(lines, "\n")
	return strings.TrimRight(result, "\n"), nil
}

// EnsureBannerFile ensures banner.txt exists, generates it if it doesn't.
func EnsureBannerFile(filename, defaultText string) error {
	if _, err := os.Stat(filename); os.IsNotExist(err) {
		if defaultText == "" {
			defaultText = constants.DefaultBannerText
		}
		fmt.Printf("Banner file not found, generating %s with Doom font...\n", filename)
		err := GenerateBannerWithDoomFont(defaultText, filename)
		if err != nil {
			return fmt.Errorf("failed to generate banner file: %w", err)
		}
		fmt.Printf("Banner file generated: %s\n", filename)
	}
	return nil
}

// PrintBannerFromFile ensures the banner file exists (generating it if
// needed), then prints its contents with ANSI gradient coloring. This
// combines EnsureBannerFile + file read + colored output in one call.
func PrintBannerFromFile(filename, defaultText string) error {
	if err := EnsureBannerFile(filename, defaultText); err != nil {
		return fmt.Errorf("failed to ensure banner file: %w", err)
	}
	data, err := os.ReadFile(filename)
	if err != nil {
		return err
	}
	lines := strings.Split(string(data), "\n")
	colors := []string{
		constants.ANSIBannerGradient1,
		constants.ANSIBannerGradient2,
		constants.ANSIBannerGradient3,
		constants.ANSIBannerGradient4,
		constants.ANSIBannerGradient5,
		constants.ANSIBannerGradient6,
	}
	for i, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		color := colors[i%len(colors)]
		fmt.Println(color + line + constants.ANSIReset)
	}
	return nil
}

// PrintBanner prints the ASCII art banner to the given writer (typically os.Stdout).
// If bannerFile is non-empty and exists, its content is printed; otherwise the
// text is rendered with the local Doom font.
func PrintBanner(w io.Writer, text, bannerFile string) error {
	if bannerFile != "" {
		if data, err := os.ReadFile(bannerFile); err == nil && len(data) > 0 {
			fmt.Fprintln(w, string(data))
			return nil
		}
	}
	if text == "" {
		text = constants.DefaultBannerText
	}
	banner, err := generateBannerWithLocalDoom(text)
	if err != nil {
		return err
	}
	if banner != "" {
		fmt.Fprintln(w, banner)
	}
	return nil
}

// PrintBannerColored prints the banner with ANSI gradient coloring.
// Each line gets a slightly different shade, creating a gradient effect.
func PrintBannerColored(w io.Writer, text string) error {
	if text == "" {
		text = constants.DefaultBannerText
	}
	banner, err := generateBannerWithLocalDoom(text)
	if err != nil {
		return err
	}
	if banner == "" {
		return nil
	}
	colors := []string{
		constants.ANSIBannerGradient1,
		constants.ANSIBannerGradient2,
		constants.ANSIBannerGradient3,
		constants.ANSIBannerGradient4,
		constants.ANSIBannerGradient5,
		constants.ANSIBannerGradient6,
	}
	lines := strings.Split(banner, "\n")
	// Trim trailing empty lines from font padding.
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	for i, line := range lines {
		color := colors[i%len(colors)]
		fmt.Fprintf(w, "%s%s%s\n", color, line, constants.ANSIReset)
	}
	return nil
}

// BannerInfo contains metadata printed alongside the banner.
type BannerInfo struct {
	AppName   string
	Version   string
	GoVersion string
	BuildTime string
	GitCommit string
	Profile   string
	StartTime time.Time
}

// PrintBannerWithInfo prints the colored banner immediately followed by a
// compact two-column info panel separated by a single divider line.
//
// Example output:
//
//		LING-BASE  (colored ASCII art)
//
//	 ───────────────────────────────────────────────────────────────────
//	 Application:  app-demo            Commit:   7ae518f
//	 Version:      1.0.0               Built:    2026-08-13 19:10:55 +0800
//	 Profile:      prod                Started:  2026-08-14T14:57:45+08:00
//	 Go:           go1.26.2
func PrintBannerWithInfo(w io.Writer, text string, info BannerInfo) error {
	return PrintBannerWithInfoFromFile(w, text, "", info)
}

// PrintBannerWithInfoFromFile prints the colored banner (from file if available,
// otherwise rendered from text) followed by the info panel.
func PrintBannerWithInfoFromFile(w io.Writer, text, bannerFile string, info BannerInfo) error {
	if bannerFile != "" {
		if data, err := os.ReadFile(bannerFile); err == nil && len(data) > 0 {
			// Print file content with gradient coloring, then info panel.
			lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
			colors := []string{
				constants.ANSIBannerGradient1,
				constants.ANSIBannerGradient2,
				constants.ANSIBannerGradient3,
				constants.ANSIBannerGradient4,
				constants.ANSIBannerGradient5,
				constants.ANSIBannerGradient6,
			}
			for i, line := range lines {
				if strings.TrimSpace(line) == "" {
					continue
				}
				color := colors[i%len(colors)]
				fmt.Fprintln(w, color+line+constants.ANSIReset)
			}
		} else {
			if err := PrintBannerColored(w, text); err != nil {
				return err
			}
		}
	} else {
		if err := PrintBannerColored(w, text); err != nil {
			return err
		}
	}

	cLabel := constants.ANSIBannerGradient1 // light blue
	cValue := constants.ANSIBannerGradient4 // medium blue
	cDim := "\x1b[38;5;245m"                // gray
	r := constants.ANSIReset

	// Build all info entries (label, value).
	type entry struct{ label, val string }
	entries := []entry{
		{"Application", info.AppName},
		{"Version", info.Version},
		{"Profile", info.Profile},
		{"Go", info.GoVersion},
		{"Commit", info.GitCommit},
		{"Built", info.BuildTime},
		{"Started", info.StartTime.Format(time.RFC3339)},
	}
	filtered := entries[:0]
	for _, e := range entries {
		if e.val == "" {
			e.val = "-"
		}
		filtered = append(filtered, e)
	}
	entries = filtered

	// Calculate column widths.
	maxLabel := 0
	maxVal := 0
	for _, e := range entries {
		if len(e.label) > maxLabel {
			maxLabel = len(e.label)
		}
		if len(e.val) > maxVal {
			maxVal = len(e.val)
		}
	}

	// Each cell: " " + label + ":" + "  " + value + padding
	cellWidth := 1 + maxLabel + 1 + 2 + maxVal
	colSep := "    "
	half := (len(entries) + 1) / 2
	dividerWidth := cellWidth*2 + len(colSep)

	// Single divider line right after banner (no blank line gap).
	fmt.Fprint(w, "  "+cDim+strings.Repeat("─", dividerWidth)+r+"\n")

	for i := 0; i < half; i++ {
		left := entries[i]
		leftCell := buildCell(left, maxLabel, maxVal, cLabel, cValue, r)

		var rightCell string
		if i+half < len(entries) {
			right := entries[i+half]
			rightCell = buildCell(right, maxLabel, maxVal, cLabel, cValue, r)
		} else {
			rightCell = ""
		}

		fmt.Fprint(w, "  "+leftCell+colSep+rightCell+r+"\n")
	}

	fmt.Fprintln(w)
	return nil
}

// buildCell returns the visible string for one info cell:
// " Label:  value    " padded to cellWidth display columns.
func buildCell(e struct{ label, val string }, maxLabel, maxVal int, cLabel, cValue, r string) string {
	labelPad := strings.Repeat(" ", maxLabel-len(e.label))
	valPad := strings.Repeat(" ", maxVal-len(e.val))
	return " " + cLabel + e.label + labelPad + ":" + r + "  " + cValue + e.val + r + valPad
}
