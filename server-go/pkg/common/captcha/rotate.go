package captcha

import (
	"fmt"
	"image"
	"image/color"
	"math"
	"math/rand"
	"time"
)

const (
	defaultRotateSize      = 200
	defaultRotateTolerance = 12 // degrees
)

// rotateStored holds the target rotation angle (degrees, 0-359).
type rotateStored struct {
	Angle int
}

// RotateCaptcha is a rotation challenge: an image is rotated by a random
// angle and the user must rotate it back to upright (0 degrees).
// The server stores the angle the image was rotated by; the user submits the
// angle they rotated it back. A pass requires the residual to be within
// tolerance of 0 (mod 360).
type RotateCaptcha struct {
	size       int
	tolerance  int // tolerance in degrees
	expiration time.Duration
	store      Store
}

// NewRotateCaptcha creates a rotate captcha generator.
func NewRotateCaptcha(size, tolerance int, expiration time.Duration, store Store) *RotateCaptcha {
	if store == nil {
		store = NewMemoryStore()
	}
	if size <= 0 {
		size = defaultRotateSize
	}
	if tolerance < 0 {
		tolerance = defaultRotateTolerance
	}
	return &RotateCaptcha{
		size:       size,
		tolerance:  tolerance,
		expiration: expiration,
		store:      store,
	}
}

// Generate creates a rotate challenge. The response includes a circular image
// rotated by a random angle; the user must rotate it back to upright.
func (rc *RotateCaptcha) Generate() (*Result, error) {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	// Avoid near-upright starts so the challenge is always obvious.
	angle := rng.Intn(300) + 30 // 30..329

	img := rc.generateImage(rng)
	rotated := rc.rotate(img, float64(angle))

	imgURL, err := encodePNGDataURL(rotated)
	if err != nil {
		return nil, fmt.Errorf("failed to encode image: %w", err)
	}

	id := generateID()
	expires := time.Now().Add(rc.expiration)
	if err := rc.store.Set(id, rotateStored{Angle: angle}, expires); err != nil {
		return nil, fmt.Errorf("failed to store captcha: %w", err)
	}

	return &Result{
		ID:   id,
		Type: TypeRotate,
		Data: map[string]interface{}{
			"size":      rc.size,
			"image":     imgURL,
			"tolerance": rc.tolerance,
		},
		Expires: expires,
	}, nil
}

// Verify checks that the user's rotation angle brings the image within
// tolerance of upright. The user submits the angle they rotated; the residual
// is (storedAngle - userAngle) mod 360, which must be within tolerance of 0.
func (rc *RotateCaptcha) Verify(id string, userAngle int) (bool, error) {
	return rc.store.VerifyWithFunc(id, userAngle, rc.compare)
}

// compare checks whether the residual rotation is within tolerance of 0 degrees.
func (rc *RotateCaptcha) compare(stored, input interface{}) bool {
	s, ok1 := stored.(rotateStored)
	v, ok2 := input.(int)
	if !ok1 || !ok2 {
		return false
	}
	residual := (s.Angle - v) % 360
	if residual < 0 {
		residual += 360
	}
	return residual <= rc.tolerance || residual >= 360-rc.tolerance
}

// generateImage creates a circular mini-landscape with a clear upright cue
// (sky on top, ground on bottom, sun + arrow).
func (rc *RotateCaptcha) generateImage(rng *rand.Rand) image.Image {
	size := rc.size
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	center := float64(size) / 2
	radius := float64(size)/2 - 2

	skyTop := color.RGBA{70, 150, 255, 255}
	skyBot := color.RGBA{160, 210, 255, 255}
	groundTop := color.RGBA{90, 180, 70, 255}
	groundBot := color.RGBA{50, 120, 45, 255}
	horizon := int(float64(size) * 0.58)

	outside := color.RGBA{0, 0, 0, 0}

	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx := float64(x) - center
			dy := float64(y) - center
			dist := math.Sqrt(dx*dx + dy*dy)
			if dist > radius {
				img.Set(x, y, outside)
				continue
			}
			if y < horizon {
				t := float64(y) / float64(max(1, horizon))
				img.Set(x, y, lerpRGBA(skyTop, skyBot, t))
			} else {
				t := float64(y-horizon) / float64(max(1, size-horizon))
				img.Set(x, y, lerpRGBA(groundTop, groundBot, t))
			}
		}
	}

	// Sun in the upper-left quadrant — strong orientation cue.
	sunCX := size / 3
	sunCY := size / 4
	sunR := size / 10
	sunCol := color.RGBA{255, 210, 60, 255}
	fillCircleOpaque(img, sunCX, sunCY, sunR, sunCol, center, radius)

	// Simple house near the horizon for extra upright signal.
	houseW := size / 5
	houseH := size / 6
	hx := size/2 - houseW/4
	hy := horizon - houseH/3
	roof := color.RGBA{200, 70, 60, 255}
	wall := color.RGBA{240, 230, 200, 255}
	for y := hy; y < hy+houseH; y++ {
		for x := hx; x < hx+houseW; x++ {
			if insideCircle(x, y, center, radius) {
				img.Set(x, y, wall)
			}
		}
	}
	// Triangular roof.
	apexY := hy - houseH/2
	for y := apexY; y < hy; y++ {
		progress := float64(y-apexY) / float64(max(1, hy-apexY))
		half := int(float64(houseW/2) * progress)
		for x := hx + houseW/2 - half; x <= hx+houseW/2+half; x++ {
			if insideCircle(x, y, center, radius) {
				img.Set(x, y, roof)
			}
		}
	}

	// Large upward arrow at the top — unmistakable "this way is up".
	arrow := color.RGBA{255, 50, 50, 255}
	arrowOutline := color.RGBA{255, 255, 255, 255}
	cx := size / 2
	arrowH := size / 4
	arrowW := size / 6
	for dy := 0; dy < arrowH; dy++ {
		halfW := arrowW * (arrowH - dy) / arrowH / 2
		if halfW < 1 {
			halfW = 1
		}
		for dx := -halfW - 1; dx <= halfW+1; dx++ {
			px := cx + dx
			py := 10 + dy
			if !insideCircle(px, py, center, radius) {
				continue
			}
			if abs(dx) <= halfW {
				img.Set(px, py, arrow)
			} else {
				img.Set(px, py, arrowOutline)
			}
		}
	}

	// Thin white rim so the disc reads clearly on any page background.
	rim := color.RGBA{255, 255, 255, 220}
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx := float64(x) - center
			dy := float64(y) - center
			dist := math.Sqrt(dx*dx + dy*dy)
			if dist <= radius && dist >= radius-2.5 {
				img.Set(x, y, rim)
			}
		}
	}

	_ = rng // kept for API symmetry / future variation
	return img
}

func lerpRGBA(a, b color.RGBA, t float64) color.RGBA {
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	return color.RGBA{
		clampByte(int(float64(a.R)*(1-t)+float64(b.R)*t), 0),
		clampByte(int(float64(a.G)*(1-t)+float64(b.G)*t), 0),
		clampByte(int(float64(a.B)*(1-t)+float64(b.B)*t), 0),
		255,
	}
}

func insideCircle(x, y int, center, radius float64) bool {
	dx := float64(x) - center
	dy := float64(y) - center
	return dx*dx+dy*dy <= radius*radius
}

func fillCircleOpaque(img *image.RGBA, cx, cy, rad int, c color.RGBA, center, radius float64) {
	r2 := rad * rad
	for y := cy - rad; y <= cy+rad; y++ {
		for x := cx - rad; x <= cx+rad; x++ {
			if (x-cx)*(x-cx)+(y-cy)*(y-cy) > r2 {
				continue
			}
			if insideCircle(x, y, center, radius) {
				img.Set(x, y, c)
			}
		}
	}
}

// rotate rotates img by angle degrees clockwise and returns a new image of
// the same dimensions. Pixels outside the original image bounds become
// transparent.
func (rc *RotateCaptcha) rotate(img image.Image, angle float64) image.Image {
	size := rc.size
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	center := float64(size) / 2
	radius := float64(size)/2 - 2

	rad := angle * math.Pi / 180
	cos := math.Cos(rad)
	sin := math.Sin(rad)

	transparent := color.RGBA{0, 0, 0, 0}

	// Inverse rotation: for each destination pixel, find the source pixel.
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx := float64(x) - center
			dy := float64(y) - center
			if dx*dx+dy*dy > radius*radius {
				dst.Set(x, y, transparent)
				continue
			}
			sx := dx*cos + dy*sin + center
			sy := -dx*sin + dy*cos + center
			if sx >= 0 && sx < float64(size) && sy >= 0 && sy < float64(size) {
				dst.Set(x, y, img.At(int(sx), int(sy)))
			} else {
				dst.Set(x, y, transparent)
			}
		}
	}

	return dst
}
