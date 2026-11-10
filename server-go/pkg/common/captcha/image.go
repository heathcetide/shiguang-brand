package captcha

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/golang/freetype"
	"github.com/golang/freetype/truetype"
	"golang.org/x/image/font/gofont/goregular"
)

// ImageCaptcha generates distorted-text image challenges.
type ImageCaptcha struct {
	width      int
	height     int
	length     int
	expiration time.Duration
	store      Store
	rng        *rand.Rand
	mu         sync.Mutex
}

// NewImageCaptcha creates an image captcha generator.
func NewImageCaptcha(width, height, length int, expiration time.Duration, store Store) *ImageCaptcha {
	if store == nil {
		store = NewMemoryStore()
	}
	return &ImageCaptcha{
		width:      width,
		height:     height,
		length:     length,
		expiration: expiration,
		store:      store,
		rng:        rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// Generate produces a new image captcha challenge.
func (ic *ImageCaptcha) Generate() (*Result, error) {
	code := ic.generateCode()

	img, err := ic.generateImage(code)
	if err != nil {
		return nil, fmt.Errorf("failed to generate image: %w", err)
	}

	imgBase64, err := ic.imageToBase64(img)
	if err != nil {
		return nil, fmt.Errorf("failed to encode image: %w", err)
	}

	id := generateID()
	expires := time.Now().Add(ic.expiration)
	if err := ic.store.Set(id, code, expires); err != nil {
		return nil, fmt.Errorf("failed to store captcha: %w", err)
	}

	return &Result{
		ID:      id,
		Type:    TypeImage,
		Data:    map[string]interface{}{"image": imgBase64, "length": ic.length},
		Expires: expires,
	}, nil
}

// Verify checks the user's answer against the stored code (case-insensitive).
func (ic *ImageCaptcha) Verify(id, code string) (bool, error) {
	return ic.store.VerifyWithFunc(id, code, func(stored, input interface{}) bool {
		storedStr, ok1 := stored.(string)
		inputStr, ok2 := input.(string)
		if !ok1 || !ok2 {
			return false
		}
		return strings.EqualFold(storedStr, inputStr)
	})
}

// VerifyWithoutDelete checks without consuming the captcha (for pre-verification).
func (ic *ImageCaptcha) VerifyWithoutDelete(id, code string) (bool, error) {
	return ic.store.VerifyWithFuncWithoutDelete(id, code, func(stored, input interface{}) bool {
		storedStr, ok1 := stored.(string)
		inputStr, ok2 := input.(string)
		if !ok1 || !ok2 {
			return false
		}
		return strings.EqualFold(storedStr, inputStr)
	})
}

// generateCode produces a random alphanumeric code, excluding easily confused
// characters (0, O, I, 1, l).
func (ic *ImageCaptcha) generateCode() string {
	const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	ic.mu.Lock()
	defer ic.mu.Unlock()
	var code strings.Builder
	for i := 0; i < ic.length; i++ {
		code.WriteByte(chars[ic.rng.Intn(len(chars))])
	}
	return code.String()
}

// generateImage renders the captcha code onto a distorted background.
func (ic *ImageCaptcha) generateImage(code string) (image.Image, error) {
	img := image.NewRGBA(image.Rect(0, 0, ic.width, ic.height))

	// Fill background.
	bgColor := color.RGBA{240, 240, 240, 255}
	for y := 0; y < ic.height; y++ {
		for x := 0; x < ic.width; x++ {
			img.Set(x, y, bgColor)
		}
	}

	ic.mu.Lock()
	// Draw interference lines.
	for i := 0; i < 5; i++ {
		x1 := ic.rng.Intn(ic.width)
		y1 := ic.rng.Intn(ic.height)
		x2 := ic.rng.Intn(ic.width)
		y2 := ic.rng.Intn(ic.height)
		lineColor := color.RGBA{
			uint8(ic.rng.Intn(200)),
			uint8(ic.rng.Intn(200)),
			uint8(ic.rng.Intn(200)),
			255,
		}
		drawLine(img, x1, y1, x2, y2, lineColor)
	}

	// Draw interference dots.
	for i := 0; i < 50; i++ {
		x := ic.rng.Intn(ic.width)
		y := ic.rng.Intn(ic.height)
		dotColor := color.RGBA{
			uint8(ic.rng.Intn(200)),
			uint8(ic.rng.Intn(200)),
			uint8(ic.rng.Intn(200)),
			255,
		}
		img.Set(x, y, dotColor)
	}
	ic.mu.Unlock()

	// Draw text.
	if err := ic.drawText(img, code); err != nil {
		return nil, err
	}

	return img, nil
}

// drawText renders each character with a random color and slight position jitter.
func (ic *ImageCaptcha) drawText(img *image.RGBA, text string) error {
	fontData, err := truetype.Parse(goregular.TTF)
	if err != nil {
		return fmt.Errorf("failed to parse font: %w", err)
	}

	c := freetype.NewContext()
	c.SetDPI(72)
	c.SetFont(fontData)
	c.SetFontSize(32)
	c.SetClip(img.Bounds())
	c.SetDst(img)
	c.SetSrc(image.Black)

	charWidth := float64(ic.width) / float64(len(text))
	y := float64(ic.height)/2 + 12

	ic.mu.Lock()
	defer ic.mu.Unlock()

	for i, char := range text {
		x := float64(i)*charWidth + charWidth/2 - 8

		textColor := color.RGBA{
			uint8(ic.rng.Intn(100) + 50),
			uint8(ic.rng.Intn(100) + 50),
			uint8(ic.rng.Intn(100) + 50),
			255,
		}

		c.SetSrc(&image.Uniform{textColor})
		pt := freetype.Pt(int(x), int(y))
		if _, err := c.DrawString(string(char), pt); err != nil {
			return fmt.Errorf("failed to draw text: %w", err)
		}
	}

	return nil
}

// imageToBase64 encodes an image as a PNG data URL.
func (ic *ImageCaptcha) imageToBase64(img image.Image) (string, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}
