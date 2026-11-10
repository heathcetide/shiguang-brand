// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package money provides precise monetary value handling using fixed-point
// integer arithmetic. Internally amounts are stored as int64 in the smallest
// currency unit (e.g. cents for USD/EUR, fen for CNY, whole yen for JPY) so
// that no floating-point rounding error is introduced during arithmetic.
//
// # Quick start
//
//	m := money.New(199, "USD")          // $1.99
//	m.Decimal()                         // 1.99
//	m.String()                          // "USD 1.99"
//	m.Format()                          // "1.99"
//
//	a := money.FromDecimal(10.50, "USD")
//	b := money.New(250, "USD")          // $2.50
//	sum, _ := a.Add(b)                  // $13.00
//
//	parsed, _ := money.Parse("12.34", "USD")
//
//	alloc, _ := money.New(100, "USD").Allocate([]int{1, 1, 1}) // 34+33+33 = 100
//	r := money.Round(2.345, "USD", money.RoundHalfUp)           // $2.35
package money

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrCurrencyMismatch is returned when an arithmetic operation is attempted
	// between two Money values denominated in different currencies.
	ErrCurrencyMismatch = errors.New("money: currency mismatch")

	// ErrDivisionByZero is returned when a division operation has a zero divisor.
	ErrDivisionByZero = errors.New("money: division by zero")

	// ErrInvalidAmount is returned when a string cannot be parsed into a money amount.
	ErrInvalidAmount = errors.New("money: invalid amount")

	// ErrUnknownCurrency is returned when a currency has no registered precision.
	ErrUnknownCurrency = errors.New("money: unknown currency")

	// ErrNoAllocationParts is returned when Allocate is called with no parts.
	ErrNoAllocationParts = errors.New("money: no allocation parts")

	// ErrNegativeAllocationPart is returned when Allocate is given a negative ratio.
	ErrNegativeAllocationPart = errors.New("money: negative allocation part")
)

// ──────────────────────────────────────────────
// Currency metadata
// ──────────────────────────────────────────────

// currencyPrecision maps ISO 4217 currency codes to the number of decimal
// places in their smallest unit. A precision of 0 means the currency has no
// fractional unit (e.g. JPY).
var currencyPrecision = map[string]int{
	"USD": 2, // US Dollar
	"EUR": 2, // Euro
	"GBP": 2, // British Pound
	"CNY": 2, // Chinese Yuan
	"JPY": 0, // Japanese Yen
	"KRW": 0, // South Korean Won
	"CHF": 2, // Swiss Franc
	"CAD": 2, // Canadian Dollar
	"AUD": 2, // Australian Dollar
	"NZD": 2, // New Zealand Dollar
	"HKD": 2, // Hong Kong Dollar
	"SGD": 2, // Singapore Dollar
	"INR": 2, // Indian Rupee
	"RUB": 2, // Russian Ruble
	"BRL": 2, // Brazilian Real
	"MXN": 2, // Mexican Peso
	"ZAR": 2, // South African Rand
	"SEK": 2, // Swedish Krona
	"NOK": 2, // Norwegian Krone
	"DKK": 2, // Danish Krone
	"PLN": 2, // Polish Zloty
	"TRY": 2, // Turkish Lira
	"THB": 2, // Thai Baht
	"PHP": 2, // Philippine Peso
	"MYR": 2, // Malaysian Ringgit
	"IDR": 2, // Indonesian Rupiah
	"VND": 0, // Vietnamese Dong
	"TWD": 2, // Taiwan Dollar
	"ILS": 2, // Israeli Shekel
	"AED": 2, // UAE Dirham
	"SAR": 2, // Saudi Riyal
	"CLP": 0, // Chilean Peso
	"ISK": 0, // Icelandic Krona
	"UGX": 0, // Ugandan Shilling
	"RWF": 0, // Rwandan Franc
	"BIF": 0, // Burundian Franc
	"DJF": 0, // Djiboutian Franc
	"GNF": 0, // Guinean Franc
	"KMF": 0, // Comorian Franc
	"PYG": 0, // Paraguayan Guarani
	"VUV": 0, // Vanuatu Vatu
	"XAF": 0, // Central African CFA Franc
	"XOF": 0, // West African CFA Franc
	"XPF": 0, // CFP Franc
	"BHD": 3, // Bahraini Dinar
	"IQD": 3, // Iraqi Dinar
	"JOD": 3, // Jordanian Dinar
	"KWD": 3, // Kuwaiti Dinar
	"LYD": 3, // Libyan Dinar
	"OMR": 3, // Omani Rial
	"TND": 3, // Tunisian Dinar
}

// currencySymbol maps ISO 4217 currency codes to their common symbol.
var currencySymbol = map[string]string{
	"USD": "$",
	"EUR": "€",
	"GBP": "£",
	"CNY": "¥",
	"JPY": "¥",
	"KRW": "₩",
	"CHF": "CHF",
	"CAD": "C$",
	"AUD": "A$",
	"NZD": "NZ$",
	"HKD": "HK$",
	"SGD": "S$",
	"INR": "₹",
	"RUB": "₽",
	"BRL": "R$",
	"MXN": "$",
	"ZAR": "R",
	"SEK": "kr",
	"NOK": "kr",
	"DKK": "kr",
	"PLN": "zł",
	"TRY": "₺",
	"THB": "฿",
	"PHP": "₱",
	"MYR": "RM",
	"IDR": "Rp",
	"VND": "₫",
	"TWD": "NT$",
	"ILS": "₪",
	"AED": "د.إ",
	"SAR": "﷼",
	"BHD": ".د.ب",
	"KWD": "د.ك",
	"JOD": "د.ا",
	"OMR": "﷼",
}

// CurrencyPrecision returns the number of decimal places used by the given
// currency code. For unknown currencies it returns 2 (the most common case)
// as a safe default.
func CurrencyPrecision(currency string) int {
	if p, ok := currencyPrecision[currency]; ok {
		return p
	}
	return 2
}

// CurrencySymbol returns the symbol for the given currency code. For unknown
// currencies it returns the currency code itself.
func CurrencySymbol(currency string) string {
	if s, ok := currencySymbol[currency]; ok {
		return s
	}
	return currency
}

// ──────────────────────────────────────────────
// RoundingMode
// ──────────────────────────────────────────────

// RoundingMode controls how a floating-point value is rounded to the smallest
// currency unit when constructing a Money value.
type RoundingMode int

const (
	// RoundHalfUp rounds to nearest, ties away from zero (0.5 -> 1).
	RoundHalfUp RoundingMode = iota
	// RoundHalfDown rounds to nearest, ties toward zero (0.5 -> 0).
	RoundHalfDown
	// RoundHalfEven rounds to nearest, ties to even (banker's rounding).
	RoundHalfEven
	// RoundDown always rounds toward zero (truncation).
	RoundDown
	// RoundUp always rounds away from zero.
	RoundUp
)

// ──────────────────────────────────────────────
// Money
// ──────────────────────────────────────────────

// Money represents a monetary amount stored as a fixed-point integer in the
// smallest unit of the given currency. The zero value is a zero amount with an
// empty currency; prefer New to construct valid values.
type Money struct {
	amount   int64
	currency string
}

// New creates a Money value from an amount expressed in the smallest currency
// unit. For example New(100, "USD") represents $1.00 and New(199, "USD")
// represents $1.99.
func New(amount int64, currency string) Money {
	return Money{amount: amount, currency: currency}
}

// FromDecimal creates a Money value from a decimal float using the currency's
// precision and RoundHalfUp rounding. For example FromDecimal(1.99, "USD")
// yields New(199, "USD").
func FromDecimal(value float64, currency string) Money {
	return Round(value, currency, RoundHalfUp)
}

// Round creates a Money value from a decimal float using the given rounding
// mode and the currency's precision.
//
// The value is first formatted to its shortest round-trippable decimal string
// via strconv.FormatFloat and then parsed with integer arithmetic. This avoids
// the float64 multiplication (value * 10^precision) which loses precision for
// large amounts.
func Round(value float64, currency string, mode RoundingMode) Money {
	precision := CurrencyPrecision(currency)

	// Format to the shortest decimal representation that round-trips. This
	// sidesteps float64 multiplication precision loss on large amounts.
	s := strconv.FormatFloat(value, 'f', -1, 64)

	// Guard against non-finite values.
	if s == "NaN" || s == "Inf" || s == "-Inf" || s == "+Inf" {
		return Money{amount: 0, currency: currency}
	}

	negative := false
	if s != "" && s[0] == '-' {
		negative = true
		s = s[1:]
	}

	var intPart, fracPart string
	if dot := strings.Index(s, "."); dot >= 0 {
		intPart = s[:dot]
		fracPart = s[dot+1:]
	} else {
		intPart = s
	}

	// kept = the first `precision` fractional digits (zero-padded).
	// rest  = the remaining fractional digits used for rounding decisions.
	kept := fracPart
	if len(kept) > precision {
		kept = kept[:precision]
	}
	for len(kept) < precision {
		kept += "0"
	}
	rest := ""
	if len(fracPart) > precision {
		rest = fracPart[precision:]
	}

	intVal, err := strconv.ParseInt(intPart, 10, 64)
	if err != nil {
		return Money{amount: 0, currency: currency}
	}
	var fracVal int64
	if kept != "" {
		fracVal, err = strconv.ParseInt(kept, 10, 64)
		if err != nil {
			return Money{amount: 0, currency: currency}
		}
	}

	amount := intVal*pow10(precision) + fracVal

	// Decide whether to round the absolute value up by one unit based on
	// the digits beyond the kept precision.
	if len(rest) > 0 {
		roundUp := false
		switch mode {
		case RoundHalfUp:
			if rest[0] >= '5' {
				roundUp = true
			}
		case RoundHalfDown:
			if rest[0] > '5' {
				roundUp = true
			} else if rest[0] == '5' {
				roundUp = hasNonZero(rest[1:])
			}
		case RoundHalfEven:
			if rest[0] > '5' {
				roundUp = true
			} else if rest[0] == '5' {
				if hasNonZero(rest[1:]) {
					roundUp = true
				} else if fracVal%2 != 0 {
					// Exact tie: round to even.
					roundUp = true
				}
			}
		case RoundDown:
			// Truncation toward zero: never round up.
		case RoundUp:
			roundUp = hasNonZero(rest)
		default:
			if rest[0] >= '5' {
				roundUp = true
			}
		}
		if roundUp {
			amount++
		}
	}

	if negative {
		amount = -amount
	}
	return Money{amount: amount, currency: currency}
}

// hasNonZero reports whether s contains any digit other than '0'.
func hasNonZero(s string) bool {
	for _, c := range s {
		if c != '0' {
			return true
		}
	}
	return false
}

// roundHalfDown rounds to nearest, ties toward zero.
func roundHalfDown(x float64) float64 {
	if x >= 0 {
		floor := math.Floor(x)
		diff := x - floor
		if diff > 0.5 {
			return floor + 1
		}
		return floor
	}
	ceil := math.Ceil(x)
	diff := ceil - x
	if diff > 0.5 {
		return ceil - 1
	}
	return ceil
}

// roundHalfEven rounds to nearest, ties to even (banker's rounding).
func roundHalfEven(x float64) float64 {
	if x >= 0 {
		floor := math.Floor(x)
		diff := x - floor
		if diff < 0.5 {
			return floor
		}
		if diff > 0.5 {
			return floor + 1
		}
		// exact tie: round to even
		if int64(floor)%2 == 0 {
			return floor
		}
		return floor + 1
	}
	ceil := math.Ceil(x)
	diff := ceil - x
	if diff < 0.5 {
		return ceil
	}
	if diff > 0.5 {
		return ceil - 1
	}
	if int64(ceil)%2 == 0 {
		return ceil
	}
	return ceil - 1
}

// roundUp rounds away from zero.
func roundUp(x float64) float64 {
	if x >= 0 {
		return math.Ceil(x)
	}
	return math.Floor(x)
}

// Parse parses a decimal string (e.g. "1.99" or "-12.50") into a Money value
// using the currency's precision. Leading/trailing whitespace is trimmed.
func Parse(s, currency string) (Money, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Money{}, ErrInvalidAmount
	}

	negative := false
	if s[0] == '-' {
		negative = true
		s = s[1:]
	} else if s[0] == '+' {
		s = s[1:]
	}

	dot := strings.Index(s, ".")
	precision := CurrencyPrecision(currency)

	var intPart, fracPart string
	if dot == -1 {
		intPart = s
		fracPart = ""
	} else {
		intPart = s[:dot]
		fracPart = s[dot+1:]
	}

	if intPart == "" {
		intPart = "0"
	}

	// Reject strings with no digits at all (e.g. "." or "-").
	if intPart == "0" && fracPart == "" && dot != -1 {
		return Money{}, ErrInvalidAmount
	}

	// Validate digits.
	for _, c := range intPart {
		if c < '0' || c > '9' {
			return Money{}, ErrInvalidAmount
		}
	}
	for _, c := range fracPart {
		if c < '0' || c > '9' {
			return Money{}, ErrInvalidAmount
		}
	}

	// Pad or truncate fractional part to precision.
	if len(fracPart) > precision {
		// Truncate (do not round during parse; caller can use Round if needed).
		fracPart = fracPart[:precision]
	} else {
		fracPart = fracPart + strings.Repeat("0", precision-len(fracPart))
	}

	intVal, err := strconv.ParseInt(intPart, 10, 64)
	if err != nil {
		return Money{}, ErrInvalidAmount
	}
	var fracVal int64
	if fracPart != "" {
		fracVal, err = strconv.ParseInt(fracPart, 10, 64)
		if err != nil {
			return Money{}, ErrInvalidAmount
		}
	}

	amount := intVal*pow10(precision) + fracVal
	if negative {
		amount = -amount
	}
	return Money{amount: amount, currency: currency}, nil
}

// pow10 returns 10^n as int64.
func pow10(n int) int64 {
	r := int64(1)
	for i := 0; i < n; i++ {
		r *= 10
	}
	return r
}

// Amount returns the amount in the smallest currency unit.
func (m Money) Amount() int64 {
	return m.amount
}

// Currency returns the ISO 4217 currency code.
func (m Money) Currency() string {
	return m.currency
}

// Decimal converts the amount to a float64 in major units (e.g. dollars).
// The conversion is performed via integer division/modulo to build a decimal
// string and then strconv.ParseFloat, so no intermediate float64 arithmetic
// is used on the stored int64 amount.
func (m Money) Decimal() float64 {
	precision := CurrencyPrecision(m.currency)
	scale := pow10(precision)

	negative := m.amount < 0
	abs := m.amount
	if negative {
		abs = -abs
	}

	intPart := abs / scale
	fracPart := abs % scale

	var s string
	if precision == 0 {
		s = strconv.FormatInt(intPart, 10)
	} else {
		s = strconv.FormatInt(intPart, 10) + "." + leftPad(strconv.FormatInt(fracPart, 10), precision)
	}
	if negative {
		s = "-" + s
	}

	f, _ := strconv.ParseFloat(s, 64)
	return f
}

// String formats the money as "CUR X.YY" using the currency's precision.
func (m Money) String() string {
	return m.currency + " " + m.Format()
}

// Format formats just the numeric amount using the currency's precision,
// without the currency code.
func (m Money) Format() string {
	precision := CurrencyPrecision(m.currency)
	scale := pow10(precision)

	negative := m.amount < 0
	abs := m.amount
	if negative {
		abs = -abs
	}

	intPart := abs / scale
	fracPart := abs % scale

	var s string
	if precision == 0 {
		s = strconv.FormatInt(intPart, 10)
	} else {
		s = strconv.FormatInt(intPart, 10) + "." + leftPad(strconv.FormatInt(fracPart, 10), precision)
	}
	if negative {
		s = "-" + s
	}
	return s
}

// leftPad pads s with leading zeros to length n.
func leftPad(s string, n int) string {
	if len(s) >= n {
		return s
	}
	return strings.Repeat("0", n-len(s)) + s
}

// Add returns the sum of m and other. The currencies must match.
func (m Money) Add(other Money) (Money, error) {
	if m.currency != other.currency {
		return Money{}, ErrCurrencyMismatch
	}
	return Money{amount: m.amount + other.amount, currency: m.currency}, nil
}

// Sub returns the difference m - other. The currencies must match.
func (m Money) Sub(other Money) (Money, error) {
	if m.currency != other.currency {
		return Money{}, ErrCurrencyMismatch
	}
	return Money{amount: m.amount - other.amount, currency: m.currency}, nil
}

// Mul returns m multiplied by the integer n.
func (m Money) Mul(n int64) Money {
	return Money{amount: m.amount * n, currency: m.currency}
}

// Div divides m by n and returns the quotient (truncated toward zero). Returns
// an error if n is zero.
func (m Money) Div(n int64) (Money, error) {
	if n == 0 {
		return Money{}, ErrDivisionByZero
	}
	return Money{amount: m.amount / n, currency: m.currency}, nil
}

// DivMod divides m by n and returns both the quotient and the remainder.
func (m Money) DivMod(n int64) (Money, Money, error) {
	if n == 0 {
		return Money{}, Money{}, ErrDivisionByZero
	}
	quot := m.amount / n
	rem := m.amount % n
	return Money{amount: quot, currency: m.currency},
		Money{amount: rem, currency: m.currency}, nil
}

// Neg returns the additive inverse of m.
func (m Money) Neg() Money {
	return Money{amount: -m.amount, currency: m.currency}
}

// Abs returns the absolute value of m.
func (m Money) Abs() Money {
	if m.amount < 0 {
		return Money{amount: -m.amount, currency: m.currency}
	}
	return m
}

// IsZero reports whether m represents zero.
func (m Money) IsZero() bool {
	return m.amount == 0
}

// IsPositive reports whether m is strictly greater than zero.
func (m Money) IsPositive() bool {
	return m.amount > 0
}

// IsNegative reports whether m is strictly less than zero.
func (m Money) IsNegative() bool {
	return m.amount < 0
}

// Equal reports whether m and other have the same currency and amount.
func (m Money) Equal(other Money) bool {
	return m.currency == other.currency && m.amount == other.amount
}

// LessThan reports whether m is less than other. The currencies must match.
func (m Money) LessThan(other Money) bool {
	return m.Compare(other) < 0
}

// GreaterThan reports whether m is greater than other. The currencies must match.
func (m Money) GreaterThan(other Money) bool {
	return m.Compare(other) > 0
}

// Compare returns -1, 0, or +1 depending on whether m is less than, equal to,
// or greater than other. If the currencies differ, comparison falls back to a
// lexicographic comparison of the currency codes so the result is still
// deterministic.
func (m Money) Compare(other Money) int {
	if m.currency != other.currency {
		if m.currency < other.currency {
			return -1
		}
		return 1
	}
	switch {
	case m.amount < other.amount:
		return -1
	case m.amount > other.amount:
		return 1
	default:
		return 0
	}
}

// Allocate distributes m across the given ratio parts, handling any remainder
// so that the sum of the result equals m exactly. Each part must be >= 0 and at
// least one part must be > 0.
//
// For example, allocating 100 cents across [1, 1, 1] yields [34, 33, 33].
func (m Money) Allocate(parts []int) ([]Money, error) {
	if len(parts) == 0 {
		return nil, ErrNoAllocationParts
	}
	total := 0
	for _, p := range parts {
		if p < 0 {
			return nil, ErrNegativeAllocationPart
		}
		total += p
	}
	if total == 0 {
		return nil, ErrNoAllocationParts
	}

	result := make([]Money, len(parts))
	allocated := int64(0)
	for i, p := range parts {
		share := m.amount * int64(p) / int64(total)
		result[i] = Money{amount: share, currency: m.currency}
		allocated += share
	}

	// Distribute the remainder (in smallest units) one at a time to the
	// earliest parts, following the "largest remainder" order for fairness.
	remainder := m.amount - allocated
	if remainder != 0 {
		// Order indices by descending remainder fraction so the largest
		// fractional shares receive the leftover units first.
		type idxFrac struct {
			i    int
			frac float64
		}
		fracs := make([]idxFrac, len(parts))
		for i, p := range parts {
			num := m.amount * int64(p)
			share := num / int64(total)
			frac := float64(num-share*int64(total)) / float64(total)
			fracs[i] = idxFrac{i: i, frac: frac}
		}
		// Simple insertion sort by descending frac, stable on index.
		for i := 1; i < len(fracs); i++ {
			for j := i; j > 0; j-- {
				if fracs[j].frac > fracs[j-1].frac {
					fracs[j], fracs[j-1] = fracs[j-1], fracs[j]
				} else {
					break
				}
			}
		}
		step := int64(1)
		if remainder < 0 {
			step = -1
		}
		for remainder != 0 {
			for _, f := range fracs {
				if remainder == 0 {
					break
				}
				result[f.i].amount += step
				remainder -= step
			}
		}
	}

	return result, nil
}

// String helpers for debugging in error messages.
var _ = fmt.Sprintf
