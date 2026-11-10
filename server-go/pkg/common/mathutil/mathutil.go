// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package mathutil provides mathematical utilities:
//
//   - Range: Clamp, Min, Max, MinMax, InRange
//   - Precision: Round, RoundTo, FloorTo, CeilTo, Truncate
//   - Statistics: Sum, Mean, Median, Mode, Variance, StdDev, Percentile
//   - Number theory: GCD, LCM, IsPrime, Factorial, Fibonacci
//   - Mapping: MapRange, Lerp
//
// # Quick start
//
//	mathutil.Clamp(15, 0, 10)           // 10
//	mathutil.Round(3.14159, 2)          // 3.14
//	mathutil.Sum([]float64{1, 2, 3})    // 6
//	mathutil.Mean([]float64{1, 2, 3})   // 2
//	mathutil.GCD(12, 18)                // 6
package mathutil

import (
	"fmt"
	"math"
	"sort"
)

// ──────────────────────────────────────────────
// Range helpers
// ──────────────────────────────────────────────

// Clamp returns value clamped to [min, max].
// Panics if min > max.
func Clamp[T int | int64 | float32 | float64](value, min, max T) T {
	if min > max {
		panic(fmt.Sprintf("mathutil: Clamp min (%v) > max (%v)", min, max))
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

// Min returns the smaller of two values.
func Min[T int | int64 | float32 | float64](a, b T) T {
	if a < b {
		return a
	}
	return b
}

// Max returns the larger of two values.
func Max[T int | int64 | float32 | float64](a, b T) T {
	if a > b {
		return a
	}
	return b
}

// MinMax returns (min, max) of two values.
func MinMax[T int | int64 | float32 | float64](a, b T) (T, T) {
	if a < b {
		return a, b
	}
	return b, a
}

// InRange returns true if value is in [min, max] (inclusive).
func InRange[T int | int64 | float32 | float64](value, min, max T) bool {
	return value >= min && value <= max
}

// MinSlice returns the minimum value in a slice.
// Panics if the slice is empty.
func MinSlice[T int | int64 | float32 | float64](s []T) T {
	if len(s) == 0 {
		panic("mathutil: MinSlice of empty slice")
	}
	result := s[0]
	for _, v := range s[1:] {
		if v < result {
			result = v
		}
	}
	return result
}

// MaxSlice returns the maximum value in a slice.
// Panics if the slice is empty.
func MaxSlice[T int | int64 | float32 | float64](s []T) T {
	if len(s) == 0 {
		panic("mathutil: MaxSlice of empty slice")
	}
	result := s[0]
	for _, v := range s[1:] {
		if v > result {
			result = v
		}
	}
	return result
}

// ──────────────────────────────────────────────
// Precision / rounding
// ──────────────────────────────────────────────

// Round rounds a float64 to the specified number of decimal places.
// Uses "round half away from zero" (banker's rounding not used).
// e.g. Round(3.14159, 2) = 3.14, Round(2.5, 0) = 3.
func Round(x float64, precision int) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	pow := math.Pow(10, float64(precision))
	return math.Round(x*pow) / pow
}

// RoundTo rounds to the nearest multiple of `to`.
// e.g. RoundTo(17, 5) = 15, RoundTo(18, 5) = 20.
func RoundTo(x, to float64) float64 {
	if to == 0 {
		return x
	}
	return math.Round(x/to) * to
}

// FloorTo rounds down to the nearest multiple of `to`.
func FloorTo(x, to float64) float64 {
	if to == 0 {
		return x
	}
	return math.Floor(x/to) * to
}

// CeilTo rounds up to the nearest multiple of `to`.
func CeilTo(x, to float64) float64 {
	if to == 0 {
		return x
	}
	return math.Ceil(x/to) * to
}

// Truncate truncates to the specified number of decimal places.
// e.g. Truncate(3.9999, 2) = 3.99.
func Truncate(x float64, precision int) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	pow := math.Pow(10, float64(precision))
	return math.Trunc(x*pow) / pow
}

// ──────────────────────────────────────────────
// Statistics
// ──────────────────────────────────────────────

// Sum returns the sum of a float64 slice.
func Sum(s []float64) float64 {
	var total float64
	for _, v := range s {
		total += v
	}
	return total
}

// SumInt returns the sum of an int slice.
func SumInt(s []int) int {
	var total int
	for _, v := range s {
		total += v
	}
	return total
}

// Mean returns the arithmetic mean (average) of a float64 slice.
// Returns NaN for an empty slice.
func Mean(s []float64) float64 {
	if len(s) == 0 {
		return math.NaN()
	}
	return Sum(s) / float64(len(s))
}

// Median returns the median of a float64 slice.
// Returns NaN for an empty slice.
func Median(s []float64) float64 {
	n := len(s)
	if n == 0 {
		return math.NaN()
	}
	sorted := make([]float64, n)
	copy(sorted, s)
	sort.Float64s(sorted)
	if n%2 == 0 {
		return (sorted[n/2-1] + sorted[n/2]) / 2
	}
	return sorted[n/2]
}

// Mode returns the most frequent value(s) in a float64 slice.
// Returns all values with the highest frequency.
// Returns an empty slice for an empty input.
func Mode(s []float64) []float64 {
	if len(s) == 0 {
		return nil
	}
	freq := make(map[float64]int)
	maxFreq := 0
	for _, v := range s {
		freq[v]++
		if freq[v] > maxFreq {
			maxFreq = freq[v]
		}
	}
	var result []float64
	for v, f := range freq {
		if f == maxFreq {
			result = append(result, v)
		}
	}
	sort.Float64s(result)
	return result
}

// Variance returns the population variance of a float64 slice.
// Returns NaN for an empty slice.
func Variance(s []float64) float64 {
	n := len(s)
	if n == 0 {
		return math.NaN()
	}
	m := Mean(s)
	var sumSqDiff float64
	for _, v := range s {
		diff := v - m
		sumSqDiff += diff * diff
	}
	return sumSqDiff / float64(n)
}

// SampleVariance returns the sample variance (Bessel's correction).
// Returns NaN for slices with fewer than 2 elements.
func SampleVariance(s []float64) float64 {
	n := len(s)
	if n < 2 {
		return math.NaN()
	}
	m := Mean(s)
	var sumSqDiff float64
	for _, v := range s {
		diff := v - m
		sumSqDiff += diff * diff
	}
	return sumSqDiff / float64(n-1)
}

// StdDev returns the population standard deviation.
// Returns NaN for an empty slice.
func StdDev(s []float64) float64 {
	return math.Sqrt(Variance(s))
}

// SampleStdDev returns the sample standard deviation.
// Returns NaN for slices with fewer than 2 elements.
func SampleStdDev(s []float64) float64 {
	return math.Sqrt(SampleVariance(s))
}

// Percentile returns the p-th percentile (0-100) of a float64 slice.
// Uses linear interpolation between closest ranks.
// Returns NaN for an empty slice. Panics if p is not in [0, 100].
func Percentile(s []float64, p float64) float64 {
	if len(s) == 0 {
		return math.NaN()
	}
	if p < 0 || p > 100 {
		panic(fmt.Sprintf("mathutil: Percentile p = %v, must be [0, 100]", p))
	}
	sorted := make([]float64, len(s))
	copy(sorted, s)
	sort.Float64s(sorted)

	if p == 0 {
		return sorted[0]
	}
	if p == 100 {
		return sorted[len(sorted)-1]
	}

	rank := p / 100 * float64(len(sorted)-1)
	lower := int(math.Floor(rank))
	upper := int(math.Ceil(rank))
	if lower == upper {
		return sorted[lower]
	}
	// Linear interpolation.
	frac := rank - float64(lower)
	return sorted[lower] + frac*(sorted[upper]-sorted[lower])
}

// Quantile returns the q-th quantile (0-1) of a float64 slice.
func Quantile(s []float64, q float64) float64 {
	return Percentile(s, q*100)
}

// ──────────────────────────────────────────────
// Number theory
// ──────────────────────────────────────────────

// GCD returns the greatest common divisor of a and b.
// GCD(0, 0) returns 0.
func GCD(a, b int) int {
	a, b = abs(a), abs(b)
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

// LCM returns the least common multiple of a and b.
// Returns 0 if either a or b is 0.
func LCM(a, b int) int {
	if a == 0 || b == 0 {
		return 0
	}
	return abs(a) / GCD(a, b) * abs(b)
}

// IsPrime returns true if n is a prime number.
// n must be non-negative. Returns false for n < 2.
func IsPrime(n int) bool {
	if n < 2 {
		return false
	}
	if n == 2 {
		return true
	}
	if n%2 == 0 {
		return false
	}
	sqrt := int(math.Sqrt(float64(n)))
	for i := 3; i <= sqrt; i += 2 {
		if n%i == 0 {
			return false
		}
	}
	return true
}

// Factorial returns n! (n factorial).
// Panics if n < 0. Returns 1 for n = 0.
// Note: will overflow for n > 20 (int64).
func Factorial(n int) int {
	if n < 0 {
		panic("mathutil: Factorial of negative number")
	}
	if n <= 1 {
		return 1
	}
	result := 1
	for i := 2; i <= n; i++ {
		result *= i
	}
	return result
}

// Fibonacci returns the n-th Fibonacci number (0-indexed).
// F(0)=0, F(1)=1, F(2)=1, F(3)=2, ...
// Panics if n < 0.
func Fibonacci(n int) int {
	if n < 0 {
		panic("mathutil: Fibonacci of negative number")
	}
	if n <= 1 {
		return n
	}
	a, b := 0, 1
	for i := 2; i <= n; i++ {
		a, b = b, a+b
	}
	return b
}

// IsPowerOfTwo returns true if n is a power of two.
// Returns false for n <= 0.
func IsPowerOfTwo(n int) bool {
	return n > 0 && (n&(n-1)) == 0
}

// NextPowerOfTwo returns the smallest power of two >= n.
// Returns 1 for n <= 1. Panics if n is too large.
func NextPowerOfTwo(n int) int {
	if n <= 1 {
		return 1
	}
	p := 1
	for p < n {
		p <<= 1
		if p <= 0 {
			panic("mathutil: NextPowerOfTwo overflow")
		}
	}
	return p
}

// ──────────────────────────────────────────────
// Mapping / interpolation
// ──────────────────────────────────────────────

// MapRange maps a value from one range to another.
// e.g. MapRange(5, 0, 10, 0, 100) = 50.
// If input range is zero, returns the output start.
func MapRange(value, inMin, inMax, outMin, outMax float64) float64 {
	if inMax == inMin {
		return outMin
	}
	return (value-inMin)/(inMax-inMin)*(outMax-outMin) + outMin
}

// Lerp performs linear interpolation between a and b.
// t=0 returns a, t=1 returns b, t=0.5 returns the midpoint.
func Lerp(a, b, t float64) float64 {
	return a + (b-a)*t
}

// InvLerp returns the interpolation factor t such that
// Lerp(a, b, t) = value. Returns 0 if a == b.
func InvLerp(a, b, value float64) float64 {
	if a == b {
		return 0
	}
	return (value - a) / (b - a)
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// abs returns the absolute value of an integer.
func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// Abs returns the absolute value of an integer.
func Abs(n int) int { return abs(n) }

// Sign returns -1, 0, or 1 based on the sign of x.
func Sign(x float64) float64 {
	if math.IsNaN(x) {
		return math.NaN()
	}
	if x > 0 {
		return 1
	}
	if x < 0 {
		return -1
	}
	return 0
}

// IsInteger returns true if x is a whole number.
func IsInteger(x float64) bool {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return false
	}
	return x == math.Trunc(x)
}

// IsEven returns true if n is even.
func IsEven(n int) bool { return n%2 == 0 }

// IsOdd returns true if n is odd.
func IsOdd(n int) bool { return n%2 != 0 }

// Square returns x^2.
func Square(x float64) float64 { return x * x }

// Cube returns x^3.
func Cube(x float64) float64 { return x * x * x }
