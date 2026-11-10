// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package i18n

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Formatter handles locale-specific formatting of numbers, currency, dates,
// and relative time.
type Formatter struct {
	locale Locale
}

// NewFormatter creates a formatter for the given locale.
func NewFormatter(locale Locale) *Formatter {
	return &Formatter{locale: locale}
}

// NumberFormat holds locale-specific number formatting rules.
type NumberFormat struct {
	DecimalSeparator  string
	ThousandSeparator string
}

// CurrencyFormat holds locale-specific currency formatting rules.
type CurrencyFormat struct {
	Symbol         string
	SymbolPosition string // "before" or "after"
}

// TimeUnits holds translated relative-time unit labels.
type TimeUnits struct {
	JustNow string
	Seconds string
	Minutes string
	Hours   string
	Days    string
	Months  string
	Years   string
}

// FormatNumber formats a number with the given decimal places and
// locale-specific separators.
func (f *Formatter) FormatNumber(number float64, decimals int) string {
	nf := f.getNumberFormat()
	formatted := fmt.Sprintf("%."+strconv.Itoa(decimals)+"f", number)
	if nf.DecimalSeparator != "." {
		parts := strings.Split(formatted, ".")
		if len(parts) == 2 {
			formatted = parts[0] + nf.DecimalSeparator + parts[1]
		}
	}
	if nf.ThousandSeparator != "" {
		formatted = f.addThousandSeparators(formatted, nf.ThousandSeparator, nf.DecimalSeparator)
	}
	return formatted
}

// FormatCurrency formats a monetary amount with the locale's currency symbol.
func (f *Formatter) FormatCurrency(amount float64, currency string) string {
	cf := f.getCurrencyFormat(currency)
	formattedAmount := f.FormatNumber(amount, 2)
	if cf.SymbolPosition == "after" {
		return formattedAmount + " " + cf.Symbol
	}
	return cf.Symbol + formattedAmount
}

// FormatDate formats a date using a token-based format string.
// Supported tokens: YYYY, MM, DD, HH, mm, ss.
// If format is empty, the locale's default date format is used.
func (f *Formatter) FormatDate(date time.Time, format string) string {
	if format == "" {
		format = f.getDateFormat()
	}
	formatted := format
	formatted = strings.ReplaceAll(formatted, "YYYY", fmt.Sprintf("%04d", date.Year()))
	formatted = strings.ReplaceAll(formatted, "MM", fmt.Sprintf("%02d", int(date.Month())))
	formatted = strings.ReplaceAll(formatted, "DD", fmt.Sprintf("%02d", date.Day()))
	formatted = strings.ReplaceAll(formatted, "HH", fmt.Sprintf("%02d", date.Hour()))
	formatted = strings.ReplaceAll(formatted, "mm", fmt.Sprintf("%02d", date.Minute()))
	formatted = strings.ReplaceAll(formatted, "ss", fmt.Sprintf("%02d", date.Second()))
	return formatted
}

// FormatRelativeTime formats a time as a relative phrase (e.g. "2 hours ago").
func (f *Formatter) FormatRelativeTime(t time.Time) string {
	diff := time.Since(t)
	units := f.getTimeUnits()

	switch {
	case diff < time.Minute:
		seconds := int(diff.Seconds())
		if seconds <= 0 {
			return units.JustNow
		}
		return fmt.Sprintf("%d %s", seconds, units.Seconds)
	case diff < time.Hour:
		return fmt.Sprintf("%d %s", int(diff.Minutes()), units.Minutes)
	case diff < 24*time.Hour:
		return fmt.Sprintf("%d %s", int(diff.Hours()), units.Hours)
	case diff < 30*24*time.Hour:
		return fmt.Sprintf("%d %s", int(diff.Hours()/24), units.Days)
	case diff < 365*24*time.Hour:
		return fmt.Sprintf("%d %s", int(diff.Hours()/(24*30)), units.Months)
	default:
		return fmt.Sprintf("%d %s", int(diff.Hours()/(24*365)), units.Years)
	}
}

func (f *Formatter) getNumberFormat() NumberFormat {
	switch f.locale {
	case LocaleDeDE, LocaleFrFR, LocaleEsES:
		return NumberFormat{DecimalSeparator: ",", ThousandSeparator: "."}
	default:
		return NumberFormat{DecimalSeparator: ".", ThousandSeparator: ","}
	}
}

func (f *Formatter) getCurrencyFormat(currency string) CurrencyFormat {
	switch strings.ToUpper(currency) {
	case "CNY", "RMB":
		return CurrencyFormat{Symbol: "¥", SymbolPosition: "before"}
	case "USD":
		return CurrencyFormat{Symbol: "$", SymbolPosition: "before"}
	case "EUR":
		return CurrencyFormat{Symbol: "€", SymbolPosition: "after"}
	case "GBP":
		return CurrencyFormat{Symbol: "£", SymbolPosition: "before"}
	case "JPY":
		return CurrencyFormat{Symbol: "¥", SymbolPosition: "before"}
	case "KRW":
		return CurrencyFormat{Symbol: "₩", SymbolPosition: "before"}
	case "RUB":
		return CurrencyFormat{Symbol: "₽", SymbolPosition: "after"}
	case "TWD":
		return CurrencyFormat{Symbol: "NT$", SymbolPosition: "before"}
	default:
		return CurrencyFormat{Symbol: currency, SymbolPosition: "before"}
	}
}

func (f *Formatter) getDateFormat() string {
	switch f.locale {
	case LocaleZhCN, LocaleZhTW, LocaleKoKR, LocaleJaJP:
		return "YYYY-MM-DD"
	case LocaleEnUS:
		return "MM/DD/YYYY"
	case LocaleEnGB, LocaleEn:
		return "DD/MM/YYYY"
	case LocaleDeDE, LocaleFrFR, LocaleEsES:
		return "DD.MM.YYYY"
	default:
		return "YYYY-MM-DD"
	}
}

func (f *Formatter) getTimeUnits() TimeUnits {
	switch f.locale {
	case LocaleZhCN:
		return TimeUnits{JustNow: "刚刚", Seconds: "秒前", Minutes: "分钟前", Hours: "小时前", Days: "天前", Months: "个月前", Years: "年前"}
	case LocaleZhTW:
		return TimeUnits{JustNow: "剛剛", Seconds: "秒前", Minutes: "分鐘前", Hours: "小時前", Days: "天前", Months: "個月前", Years: "年前"}
	case LocaleJaJP:
		return TimeUnits{JustNow: "たった今", Seconds: "秒前", Minutes: "分前", Hours: "時間前", Days: "日前", Months: "ヶ月前", Years: "年前"}
	case LocaleKoKR:
		return TimeUnits{JustNow: "방금", Seconds: "초 전", Minutes: "분 전", Hours: "시간 전", Days: "일 전", Months: "개월 전", Years: "년 전"}
	default:
		return TimeUnits{JustNow: "just now", Seconds: "seconds ago", Minutes: "minutes ago", Hours: "hours ago", Days: "days ago", Months: "months ago", Years: "years ago"}
	}
}

func (f *Formatter) addThousandSeparators(number, separator, decimalSep string) string {
	parts := strings.Split(number, decimalSep)
	integerPart := parts[0]
	result := ""
	for i, digit := range integerPart {
		if i > 0 && (len(integerPart)-i)%3 == 0 {
			result += separator
		}
		result += string(digit)
	}
	if len(parts) > 1 {
		result += decimalSep + parts[1]
	}
	return result
}
