// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package export

import (
	"fmt"
	"io"
	"os"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

// ──────────────────────────────────────────────
// Importer interface
// ──────────────────────────────────────────────

// Importer reads tabular data from a source and returns rows as
// map[string]any (keyed by header name). This is the import-side
// counterpart to [Exporter].
type Importer interface {
	Import(r io.Reader) ([]map[string]any, error)
}

// ──────────────────────────────────────────────
// ExcelImporter
// ──────────────────────────────────────────────

// ExcelImporter reads an .xlsx workbook and returns rows as
// map[string]any. By default the first sheet is used and the first row
// is treated as the header row.
//
// For typed imports (reading into a slice of structs), use
// [ImportExcelInto] with a struct pointer and `excel` tags.
type ExcelImporter struct {
	// SheetName selects which sheet to read. Empty means the first
	// sheet (by index).
	SheetName string
	// HeaderRow is the 1-based row index of the header. Defaults to 1.
	HeaderRow int
}

// Import implements [Importer]. It reads the entire sheet into memory
// and returns a slice of map[string]any keyed by the header cell values.
func (e ExcelImporter) Import(r io.Reader) ([]map[string]any, error) {
	f, err := excelize.OpenReader(r, excelize.Options{RawCellValue: true})
	if err != nil {
		return nil, fmt.Errorf("export: open excel: %w", err)
	}
	defer f.Close()

	sheet := e.SheetName
	if sheet == "" {
		sheets := f.GetSheetList()
		if len(sheets) == 0 {
			return nil, fmt.Errorf("export: workbook has no sheets")
		}
		sheet = sheets[0]
	}

	headerRow := e.HeaderRow
	if headerRow <= 0 {
		headerRow = 1
	}

	rows, err := f.GetRows(sheet)
	if err != nil {
		return nil, fmt.Errorf("export: read sheet %q: %w", sheet, err)
	}
	if len(rows) < headerRow {
		return nil, fmt.Errorf("export: sheet has only %d rows, need at least %d for header", len(rows), headerRow)
	}

	// Build header → column index map.
	headers := rows[headerRow-1]
	headerIdx := make(map[int]string, len(headers))
	for i, h := range headers {
		h = strings.TrimSpace(h)
		if h == "" {
			continue
		}
		headerIdx[i] = h
	}

	result := make([]map[string]any, 0, len(rows)-headerRow)
	for _, row := range rows[headerRow:] {
		// Skip fully-empty rows.
		empty := true
		for _, cell := range row {
			if strings.TrimSpace(cell) != "" {
				empty = false
				break
			}
		}
		if empty {
			continue
		}
		m := make(map[string]any, len(headerIdx))
		for i, cell := range row {
			name, ok := headerIdx[i]
			if !ok {
				continue
			}
			m[name] = cell
		}
		result = append(result, m)
	}
	return result, nil
}

// ImportExcel is a package-level shortcut that reads an .xlsx from r
// using default settings (first sheet, header on row 1).
func ImportExcel(r io.Reader) ([]map[string]any, error) {
	return ExcelImporter{}.Import(r)
}

// ImportExcelFile reads an .xlsx file from disk.
func ImportExcelFile(filename string) ([]map[string]any, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, fmt.Errorf("export: open file %q: %w", filename, err)
	}
	defer f.Close()
	return ImportExcel(f)
}

// ──────────────────────────────────────────────
// Typed import (struct with `excel` tags)
// ──────────────────────────────────────────────

// ImportExcelInto reads an .xlsx from r and unmarshals each data row
// into a new instance of the struct pointed to by out. out must be a
// pointer to a slice of structs (e.g. *[]User).
//
// Struct fields use the `excel:"ColumnName"` tag to map to header
// names. Fields without an excel tag are matched case-insensitively
// against the header. The `excel:"-"` tag skips a field.
//
//	type User struct {
//	    Name  string `excel:"Name"`
//	    Email string `excel:"Email"`
//	    Age   int    `excel:"Age"`
//	}
//
//	var users []User
//	err := ImportExcelInto(file, &users)
//
// Supported field types: string, int, int64, float64, bool, time.Time.
func ImportExcelInto(r io.Reader, out any) error {
	rv := reflect.ValueOf(out)
	if rv.Kind() != reflect.Ptr {
		return fmt.Errorf("export: out must be a pointer, got %T", out)
	}
	sliceRV := rv.Elem()
	if sliceRV.Kind() != reflect.Slice {
		return fmt.Errorf("export: out must be a pointer to slice, got pointer to %s", sliceRV.Kind())
	}
	elemType := sliceRV.Type().Elem()
	if elemType.Kind() != reflect.Struct {
		return fmt.Errorf("export: slice element must be a struct, got %s", elemType.Kind())
	}

	rows, err := ImportExcel(r)
	if err != nil {
		return err
	}

	// Build field map: header name → struct field index.
	fieldMap := buildFieldMap(elemType)

	result := reflect.MakeSlice(sliceRV.Type(), 0, len(rows))
	for _, row := range rows {
		elem := reflect.New(elemType).Elem()
		for header, val := range row {
			fieldIdx, ok := fieldMap[strings.ToLower(header)]
			if !ok {
				continue
			}
			field := elem.Field(fieldIdx)
			if err := setField(field, fmt.Sprintf("%v", val)); err != nil {
				return fmt.Errorf("export: set field %q from %v: %w", header, val, err)
			}
		}
		result = reflect.Append(result, elem)
	}
	sliceRV.Set(result)
	return nil
}

// ImportExcelFileInto is like [ImportExcelInto] but reads from a file.
func ImportExcelFileInto(filename string, out any) error {
	f, err := os.Open(filename)
	if err != nil {
		return fmt.Errorf("export: open file %q: %w", filename, err)
	}
	defer f.Close()
	return ImportExcelInto(f, out)
}

// buildFieldMap returns a map from lowercased header name to struct
// field index, honoring `excel` tags.
func buildFieldMap(t reflect.Type) map[string]int {
	m := make(map[string]int)
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		tag := f.Tag.Get("excel")
		if tag == "-" {
			continue
		}
		name := tag
		if name == "" {
			name = f.Name
		}
		m[strings.ToLower(name)] = i
	}
	return m
}

// setField assigns a string value to a reflect.Value, converting as
// needed for the field's concrete type.
func setField(field reflect.Value, s string) error {
	if !field.CanSet() {
		return nil
	}
	s = strings.TrimSpace(s)
	switch field.Kind() {
	case reflect.String:
		field.SetString(s)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		if s == "" {
			return nil
		}
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return err
		}
		field.SetInt(n)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		if s == "" {
			return nil
		}
		n, err := strconv.ParseUint(s, 10, 64)
		if err != nil {
			return err
		}
		field.SetUint(n)
	case reflect.Float32, reflect.Float64:
		if s == "" {
			return nil
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return err
		}
		field.SetFloat(f)
	case reflect.Bool:
		if s == "" {
			return nil
		}
		b, err := strconv.ParseBool(s)
		if err != nil {
			// Accept "yes"/"no", "1"/"0".
			switch strings.ToLower(s) {
			case "yes", "y", "1", "true":
				b = true
			case "no", "n", "0", "false":
				b = false
			default:
				return err
			}
		}
		field.SetBool(b)
	default:
		// Handle time.Time via type check.
		if field.Type() == reflect.TypeOf(time.Time{}) {
			if s == "" {
				return nil
			}
			// Try common Excel date formats.
			formats := []string{
				"2006-01-02 15:04:05",
				"2006-01-02",
				time.RFC3339,
				"2006/01/02",
				"2006/01/02 15:04:05",
			}
			for _, layout := range formats {
				if t, err := time.Parse(layout, s); err == nil {
					field.Set(reflect.ValueOf(t))
					return nil
				}
			}
			return fmt.Errorf("cannot parse %q as time", s)
		}
		// Fallback: set as string if assignable.
		if s == "" {
			return nil
		}
		field.SetString(s)
	}
	return nil
}

// ──────────────────────────────────────────────
// CSVImporter
// ──────────────────────────────────────────────

// CSVImporter reads a CSV stream and returns rows as map[string]any.
// The first row is treated as the header.
type CSVImporter struct {
	// WithBOM indicates the input may start with a UTF-8 BOM that
	// should be stripped before parsing. Defaults to true.
	WithBOM bool
}

// Import implements [Importer].
func (c CSVImporter) Import(r io.Reader) ([]map[string]any, error) {
	if c.WithBOM || (c.WithBOM == false && true) {
		// Default: strip BOM if present. We wrap the reader to peek.
		r = &bomStripReader{r: r}
	}
	cr := newCSVReader(r)
	headers, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("export: read csv header: %w", err)
	}
	for i, h := range headers {
		headers[i] = strings.TrimSpace(h)
	}

	var result []map[string]any
	for {
		record, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("export: read csv row: %w", err)
		}
		m := make(map[string]any, len(headers))
		for i, h := range headers {
			if i < len(record) {
				m[h] = record[i]
			}
		}
		result = append(result, m)
	}
	return result, nil
}

// ImportCSV is a package-level shortcut that reads CSV with default
// settings (header on row 1, BOM auto-stripped).
func ImportCSV(r io.Reader) ([]map[string]any, error) {
	return CSVImporter{}.Import(r)
}

// ImportCSVFile reads a CSV file from disk.
func ImportCSVFile(filename string) ([]map[string]any, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, fmt.Errorf("export: open file %q: %w", filename, err)
	}
	defer f.Close()
	return ImportCSV(f)
}
