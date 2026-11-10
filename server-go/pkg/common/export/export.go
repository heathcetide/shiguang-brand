// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package export provides a small, uniform API for exporting tabular data
// (rows of map[string]any) to CSV, Excel, JSON and Markdown formats.
//
// Each format implements the Exporter interface and there are package-level
// shortcut functions (ExportCSV, ExportExcel, ...) plus ExportFile which
// picks the format from a filename extension or explicit format string.
//
// Basic usage:
//
//	rows := []map[string]any{
//	    {"name": "Alice", "age": 30},
//	    {"name": "Bob", "age": 25},
//	}
//
//	var buf bytes.Buffer
//	_ = export.ExportCSV(rows, &buf)
//
//	// Or write directly to a file:
//	_ = export.ExportFile("csv", rows, "users.csv")
package export

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/xuri/excelize/v2"
)

// ----------------------------------------------------------------------------
// Exporter interface
// ----------------------------------------------------------------------------

// Exporter is implemented by every supported format. Export writes the
// given rows to w. The header set is derived from the first row (or from
// the exporter's configured Headers) and rows are written in iteration
// order.
type Exporter interface {
	Export(rows []map[string]any, w io.Writer) error
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// toStr converts a cell value to its string representation.
func toStr(v any) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case fmt.Stringer:
		return val.String()
	default:
		return fmt.Sprintf("%v", v)
	}
}

// resolveHeaders returns the column order to use. If configured is non-empty
// it takes precedence; otherwise headers are derived from the union of keys
// across all rows, sorted for deterministic output.
func resolveHeaders(configured []string, rows []map[string]any) []string {
	if len(configured) > 0 {
		return configured
	}
	seen := make(map[string]struct{})
	for _, r := range rows {
		for k := range r {
			seen[k] = struct{}{}
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// ----------------------------------------------------------------------------
// CSVExporter
// ----------------------------------------------------------------------------

// CSVExporter exports rows as CSV. If Headers is empty the header set is
// derived from the data. A UTF-8 BOM is written first so that Excel opens
// UTF-8 CSV files with Chinese characters correctly.
type CSVExporter struct {
	// Headers optionally fixes the column order. When empty the union of
	// keys across all rows is used (sorted).
	Headers []string
	// WithBOM controls whether a UTF-8 BOM is written. Defaults to true.
	WithBOM *bool
}

// Export implements Exporter.
func (e CSVExporter) Export(rows []map[string]any, w io.Writer) error {
	bom := true
	if e.WithBOM != nil {
		bom = *e.WithBOM
	}
	if bom {
		if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
			return fmt.Errorf("export: write csv bom: %w", err)
		}
	}
	cw := csv.NewWriter(w)
	headers := resolveHeaders(e.Headers, rows)
	if err := cw.Write(headers); err != nil {
		return fmt.Errorf("export: write csv header: %w", err)
	}
	for i, r := range rows {
		record := make([]string, len(headers))
		for j, h := range headers {
			record[j] = toStr(r[h])
		}
		if err := cw.Write(record); err != nil {
			return fmt.Errorf("export: write csv row %d: %w", i, err)
		}
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		return fmt.Errorf("export: flush csv: %w", err)
	}
	return nil
}

// ----------------------------------------------------------------------------
// ExcelExporter
// ----------------------------------------------------------------------------

// ExcelExporter exports rows as an .xlsx workbook. If Headers is empty the
// header set is derived from the data. SheetName defaults to "Sheet1".
type ExcelExporter struct {
	SheetName string
	Headers   []string
}

// Export implements Exporter.
func (e ExcelExporter) Export(rows []map[string]any, w io.Writer) error {
	f := excelize.NewFile()
	defer f.Close()

	sheet := e.SheetName
	if sheet == "" {
		sheet = "Sheet1"
	}
	// The default workbook already contains "Sheet1"; rename if needed.
	if sheet != "Sheet1" {
		if err := f.SetSheetName("Sheet1", sheet); err != nil {
			return fmt.Errorf("export: set excel sheet name: %w", err)
		}
	}

	headers := resolveHeaders(e.Headers, rows)

	// Write header row.
	for j, h := range headers {
		cell, err := excelize.CoordinatesToCellName(j+1, 1)
		if err != nil {
			return fmt.Errorf("export: excel cell name: %w", err)
		}
		if err := f.SetCellValue(sheet, cell, h); err != nil {
			return fmt.Errorf("export: set excel header: %w", err)
		}
	}

	// Write data rows.
	for i, r := range rows {
		for j, h := range headers {
			cell, err := excelize.CoordinatesToCellName(j+1, i+2)
			if err != nil {
				return fmt.Errorf("export: excel cell name: %w", err)
			}
			if err := f.SetCellValue(sheet, cell, toStr(r[h])); err != nil {
				return fmt.Errorf("export: set excel cell: %w", err)
			}
		}
	}

	if _, err := f.WriteTo(w); err != nil {
		return fmt.Errorf("export: write excel: %w", err)
	}
	return nil
}

// ----------------------------------------------------------------------------
// JSONExporter
// ----------------------------------------------------------------------------

// JSONExporter exports rows as a JSON array of objects.
type JSONExporter struct{}

// Export implements Exporter.
func (JSONExporter) Export(rows []map[string]any, w io.Writer) error {
	if rows == nil {
		rows = []map[string]any{}
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(rows); err != nil {
		return fmt.Errorf("export: encode json: %w", err)
	}
	return nil
}

// ----------------------------------------------------------------------------
// MarkdownExporter
// ----------------------------------------------------------------------------

// MarkdownExporter exports rows as a GitHub-flavored Markdown table.
type MarkdownExporter struct {
	Headers []string
}

// Export implements Exporter.
func (e MarkdownExporter) Export(rows []map[string]any, w io.Writer) error {
	headers := resolveHeaders(e.Headers, rows)
	var b strings.Builder

	// Header row.
	b.WriteString("|")
	for _, h := range headers {
		fmt.Fprintf(&b, " %s |", h)
	}
	b.WriteString("\n")

	// Separator row.
	b.WriteString("|")
	for range headers {
		b.WriteString(" --- |")
	}
	b.WriteString("\n")

	// Data rows.
	for _, r := range rows {
		b.WriteString("|")
		for _, h := range headers {
			fmt.Fprintf(&b, " %s |", toStr(r[h]))
		}
		b.WriteString("\n")
	}

	if _, err := io.WriteString(w, b.String()); err != nil {
		return fmt.Errorf("export: write markdown: %w", err)
	}
	return nil
}

// ----------------------------------------------------------------------------
// Package-level shortcut functions
// ----------------------------------------------------------------------------

// ExportCSV exports rows as CSV (with UTF-8 BOM) to w.
func ExportCSV(rows []map[string]any, w io.Writer) error {
	return CSVExporter{}.Export(rows, w)
}

// ExportExcel exports rows as an .xlsx workbook to w.
func ExportExcel(rows []map[string]any, w io.Writer) error {
	return ExcelExporter{}.Export(rows, w)
}

// ExportJSON exports rows as a JSON array to w.
func ExportJSON(rows []map[string]any, w io.Writer) error {
	return JSONExporter{}.Export(rows, w)
}

// ExportMarkdown exports rows as a Markdown table to w.
func ExportMarkdown(rows []map[string]any, w io.Writer) error {
	return MarkdownExporter{}.Export(rows, w)
}

// ----------------------------------------------------------------------------
// ExportFile
// ----------------------------------------------------------------------------

// formatFromExt maps a file extension to a format name.
func formatFromExt(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".csv":
		return "csv"
	case ".xlsx":
		return "excel"
	case ".json":
		return "json"
	case ".md", ".markdown":
		return "markdown"
	default:
		return ""
	}
}

// ExportFile exports rows to a file named filename. The format is determined
// from the explicit format argument when non-empty, otherwise from the file
// extension. Supported formats: csv, excel, json, markdown.
func ExportFile(format string, rows []map[string]any, filename string) error {
	if format == "" {
		format = formatFromExt(filename)
	}
	var exp Exporter
	switch strings.ToLower(format) {
	case "csv":
		exp = CSVExporter{}
	case "excel", "xlsx":
		exp = ExcelExporter{}
	case "json":
		exp = JSONExporter{}
	case "markdown", "md":
		exp = MarkdownExporter{}
	default:
		return fmt.Errorf("export: unsupported format %q", format)
	}
	f, err := os.Create(filename)
	if err != nil {
		return fmt.Errorf("export: create file %q: %w", filename, err)
	}
	defer f.Close()
	return exp.Export(rows, f)
}
