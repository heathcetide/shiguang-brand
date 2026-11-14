package captcha

import (
	"crypto/rand"
	"encoding/binary"
)

// LoginCaptchaTypes are the kinds randomly issued for auth flows.
// Slider, click, jigsaw, and rotate are excluded: poor UX on mobile and low-quality visuals.
var LoginCaptchaTypes = []Type{TypeImage, TypeMath}

// RandomType picks one captcha kind uniformly at random.
func RandomType() Type {
	types := LoginCaptchaTypes
	if len(types) == 0 {
		return TypeSlider
	}
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return types[0]
	}
	n := binary.BigEndian.Uint64(b[:])
	return types[int(n%uint64(len(types)))]
}
