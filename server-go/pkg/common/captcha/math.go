package captcha

import (
	"fmt"
	"math/rand"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MathCaptcha generates arithmetic problems (e.g., "3 + 5 = ?").
// The user must solve the problem and submit the numeric answer.
type MathCaptcha struct {
	expiration time.Duration
	store      Store
	rng        *rand.Rand
	mu         sync.Mutex
}

// mathStored holds the expected answer (server-side only).
type mathStored struct {
	Answer int
}

// NewMathCaptcha creates a math captcha generator.
func NewMathCaptcha(expiration time.Duration, store Store) *MathCaptcha {
	if store == nil {
		store = NewMemoryStore()
	}
	return &MathCaptcha{
		expiration: expiration,
		store:      store,
		rng:        rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// Generate produces a new arithmetic challenge.
func (mc *MathCaptcha) Generate() (*Result, error) {
	a, b, op, answer := mc.generateProblem()

	question := fmt.Sprintf("%d %s %d = ?", a, op, b)
	id := generateID()
	expires := time.Now().Add(mc.expiration)

	if err := mc.store.Set(id, mathStored{Answer: answer}, expires); err != nil {
		return nil, fmt.Errorf("failed to store captcha: %w", err)
	}

	return &Result{
		ID:   id,
		Type: TypeMath,
		Data: map[string]interface{}{
			"question": question,
		},
		Expires: expires,
	}, nil
}

// Verify checks the user's numeric answer.
func (mc *MathCaptcha) Verify(id string, answer int) (bool, error) {
	return mc.store.VerifyWithFunc(id, answer, mc.compare)
}

// compare checks whether the user's answer matches the stored answer.
func (mc *MathCaptcha) compare(stored, input interface{}) bool {
	s, ok1 := stored.(mathStored)
	v, ok2 := input.(int)
	if !ok1 || !ok2 {
		return false
	}
	return s.Answer == v
}

// VerifyString checks a string answer (parsed as integer).
func (mc *MathCaptcha) VerifyString(id, answer string) (bool, error) {
	answer = strings.TrimSpace(answer)
	n, err := strconv.Atoi(answer)
	if err != nil {
		return false, nil
	}
	return mc.Verify(id, n)
}

// generateProblem creates a random arithmetic problem with operands in [1, maxOperand].
// Operations are +, -, and x (multiplication). Results are always non-negative.
func (mc *MathCaptcha) generateProblem() (a, b int, op string, answer int) {
	const maxOperand = 20
	mc.mu.Lock()
	defer mc.mu.Unlock()

	a = mc.rng.Intn(maxOperand) + 1
	b = mc.rng.Intn(maxOperand) + 1

	switch mc.rng.Intn(3) {
	case 0:
		op = "+"
		answer = a + b
	case 1:
		// Ensure non-negative result.
		if a < b {
			a, b = b, a
		}
		op = "-"
		answer = a - b
	default:
		// Keep multiplication manageable.
		if a > 10 {
			a = a%10 + 1
		}
		if b > 10 {
			b = b%10 + 1
		}
		op = "x"
		answer = a * b
	}
	return
}
