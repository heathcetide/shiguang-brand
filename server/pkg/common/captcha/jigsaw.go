package captcha

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"math/rand"
	"time"
)

const (
	defaultJigsawWidth     = 320
	defaultJigsawHeight    = 160
	defaultJigsawPieceSize = 48
	defaultJigsawTolerance = 6
)

// jigsawStored holds the target X offset for the puzzle piece.
type jigsawStored struct {
	TargetX int
}

// JigsawCaptcha is a slider puzzle challenge: a piece is cut from the image
// and the user must drag it back to the correct horizontal position.
type JigsawCaptcha struct {
	width      int
	height     int
	pieceSize  int
	tolerance  int
	expiration time.Duration
	store      Store
}

// NewJigsawCaptcha creates a jigsaw captcha generator.
func NewJigsawCaptcha(width, height, pieceSize, tolerance int, expiration time.Duration, store Store) *JigsawCaptcha {
	if store == nil {
		store = NewMemoryStore()
	}
	if width <= 0 {
		width = defaultJigsawWidth
	}
	if height <= 0 {
		height = defaultJigsawHeight
	}
	if pieceSize <= 0 {
		pieceSize = defaultJigsawPieceSize
	}
	if tolerance < 0 {
		tolerance = defaultJigsawTolerance
	}
	return &JigsawCaptcha{
		width:      width,
		height:     height,
		pieceSize:  pieceSize,
		tolerance:  tolerance,
		expiration: expiration,
		store:      store,
	}
}

// Generate creates a jigsaw challenge. The response includes the background
// image (with the piece area masked) and the puzzle piece image, both as PNG
// data URLs. The user drags the piece horizontally to fill the gap.
func (jc *JigsawCaptcha) Generate() (*Result, error) {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	bg, piece, targetX, pieceY, pieceW, pieceH, err := jc.generateImages(rng)
	if err != nil {
		return nil, fmt.Errorf("failed to generate jigsaw images: %w", err)
	}

	bgURL, err := encodePNGDataURL(bg)
	if err != nil {
		return nil, fmt.Errorf("failed to encode background: %w", err)
	}
	pieceURL, err := encodePNGDataURL(piece)
	if err != nil {
		return nil, fmt.Errorf("failed to encode piece: %w", err)
	}

	id := generateID()
	expires := time.Now().Add(jc.expiration)
	if err := jc.store.Set(id, jigsawStored{TargetX: targetX}, expires); err != nil {
		return nil, fmt.Errorf("failed to store captcha: %w", err)
	}

	return &Result{
		ID:   id,
		Type: TypeJigsaw,
		Data: map[string]interface{}{
			"width":       jc.width,
			"height":      jc.height,
			"pieceSize":   jc.pieceSize,
			"pieceWidth":  pieceW,
			"pieceHeight": pieceH,
			"pieceY":      pieceY,
			"background":  bgURL,
			"piece":       pieceURL,
			"tolerance":   jc.tolerance,
		},
		Expires: expires,
	}, nil
}

// Verify checks that the user dragged the piece to the correct X position
// within the tolerance margin.
func (jc *JigsawCaptcha) Verify(id string, userX int) (bool, error) {
	return jc.store.VerifyWithFunc(id, userX, jc.compare)
}

// compare checks whether the user's X position matches the target within tolerance.
func (jc *JigsawCaptcha) compare(stored, input interface{}) bool {
	s, ok1 := stored.(jigsawStored)
	v, ok2 := input.(int)
	if !ok1 || !ok2 {
		return false
	}
	return abs(v-s.TargetX) <= jc.tolerance
}

// generateImages creates the background (with masked cutout) and the puzzle
// piece image. Returns the target X, piece Y, and piece canvas size.
func (jc *JigsawCaptcha) generateImages(rng *rand.Rand) (bg, piece image.Image, targetX, pieceY, pieceW, pieceH int, err error) {
	size := jc.pieceSize
	tabR := size / 5
	if tabR < 6 {
		tabR = 6
	}
	// Canvas must include the protruding right tab.
	pieceW = size + tabR
	pieceH = size

	bgImg := jc.paintBackground(rng)

	minX := size + 16
	maxX := jc.width - pieceW - 12
	if maxX <= minX {
		maxX = minX + 1
	}
	targetX = rng.Intn(maxX-minX) + minX
	pieceY = (jc.height - size) / 2

	mask := jigsawMask(size, tabR, pieceW, pieceH)

	pieceImg := image.NewRGBA(image.Rect(0, 0, pieceW, pieceH))
	holeFill := color.RGBA{28, 36, 52, 255}
	edgeLight := color.RGBA{255, 255, 255, 230}
	edgeDark := color.RGBA{0, 0, 0, 160}

	for py := 0; py < pieceH; py++ {
		for px := 0; px < pieceW; px++ {
			if !mask[py*pieceW+px] {
				continue
			}
			srcX := targetX + px
			srcY := pieceY + py
			if srcX < 0 || srcX >= jc.width || srcY < 0 || srcY >= jc.height {
				continue
			}
			c := bgImg.RGBAAt(srcX, srcY)
			pieceImg.Set(px, py, c)
			bgImg.Set(srcX, srcY, holeFill)
		}
	}

	// Outline the hole so the gap is obvious (dark outer, bright inner).
	strokeMask(bgImg, targetX, pieceY, mask, pieceW, pieceH, edgeDark, 3)
	strokeMask(bgImg, targetX, pieceY, mask, pieceW, pieceH, edgeLight, 2)

	// Soft shadow + light border on the piece for drag affordance.
	outlined := image.NewRGBA(image.Rect(0, 0, pieceW, pieceH))
	draw.Draw(outlined, outlined.Bounds(), pieceImg, image.Point{}, draw.Src)
	strokePiece(outlined, mask, pieceW, pieceH, edgeDark, 2)
	strokePiece(outlined, mask, pieceW, pieceH, edgeLight, 1)

	return bgImg, outlined, targetX, pieceY, pieceW, pieceH, nil
}

// paintBackground draws a colourful, high-contrast scene so the cutout stands out.
func (jc *JigsawCaptcha) paintBackground(rng *rand.Rand) *image.RGBA {
	bgImg := image.NewRGBA(image.Rect(0, 0, jc.width, jc.height))

	c1 := color.RGBA{
		uint8(rng.Intn(60) + 40),
		uint8(rng.Intn(80) + 120),
		uint8(rng.Intn(60) + 180),
		255,
	}
	c2 := color.RGBA{
		uint8(rng.Intn(80) + 40),
		uint8(rng.Intn(100) + 140),
		uint8(rng.Intn(80) + 100),
		255,
	}
	c3 := color.RGBA{
		uint8(rng.Intn(100) + 100),
		uint8(rng.Intn(80) + 160),
		uint8(rng.Intn(60) + 60),
		255,
	}

	for y := 0; y < jc.height; y++ {
		ty := float64(y) / float64(max(1, jc.height-1))
		for x := 0; x < jc.width; x++ {
			tx := float64(x) / float64(max(1, jc.width-1))
			w1 := (1 - tx) * (1 - ty)
			w2 := tx * (1 - ty)
			w3 := ty
			sum := w1 + w2 + w3
			r := clampByte(int((float64(c1.R)*w1+float64(c2.R)*w2+float64(c3.R)*w3)/sum), 0)
			g := clampByte(int((float64(c1.G)*w1+float64(c2.G)*w2+float64(c3.G)*w3)/sum), 0)
			b := clampByte(int((float64(c1.B)*w1+float64(c2.B)*w2+float64(c3.B)*w3)/sum), 0)
			// Fine checker noise so the piece has matchable texture.
			if ((x/6)+(y/6))%2 == 0 {
				r = clampByte(int(r)+18, 0)
				g = clampByte(int(g)+12, 0)
				b = clampByte(int(b)+8, 0)
			}
			bgImg.Set(x, y, color.RGBA{r, g, b, 255})
		}
	}

	// Soft blobs for larger landmarks.
	for i := 0; i < 8; i++ {
		cx := rng.Intn(jc.width)
		cy := rng.Intn(jc.height)
		rad := rng.Intn(30) + 16
		blob := color.RGBA{
			uint8(rng.Intn(140) + 60),
			uint8(rng.Intn(140) + 60),
			uint8(rng.Intn(140) + 60),
			255,
		}
		fillCircleSoft(bgImg, cx, cy, rad, blob, 0.7)
	}

	// Contrasting rings / dots — easy visual match cues inside the piece.
	for i := 0; i < 12; i++ {
		cx := rng.Intn(jc.width)
		cy := rng.Intn(jc.height)
		rad := rng.Intn(10) + 4
		ring := color.RGBA{
			uint8(rng.Intn(100) + 150),
			uint8(rng.Intn(100) + 80),
			uint8(rng.Intn(100) + 80),
			255,
		}
		for y := cy - rad; y <= cy+rad; y++ {
			for x := cx - rad; x <= cx+rad; x++ {
				if x < 0 || y < 0 || x >= jc.width || y >= jc.height {
					continue
				}
				d2 := (x-cx)*(x-cx) + (y-cy)*(y-cy)
				if d2 <= rad*rad && d2 >= (rad-2)*(rad-2) {
					bgImg.Set(x, y, ring)
				}
			}
		}
	}

	// Wave stripes for orientation.
	stripe := color.RGBA{255, 255, 255, 255}
	for x := 0; x < jc.width; x++ {
		y := jc.height/3 + int(12*math.Sin(float64(x)/18))
		for t := -1; t <= 1; t++ {
			yy := y + t
			if yy >= 0 && yy < jc.height {
				src := bgImg.RGBAAt(x, yy)
				bgImg.Set(x, yy, color.RGBA{
					clampByte(int(float64(src.R)*0.45+float64(stripe.R)*0.55), 0),
					clampByte(int(float64(src.G)*0.45+float64(stripe.G)*0.55), 0),
					clampByte(int(float64(src.B)*0.45+float64(stripe.B)*0.55), 0),
					255,
				})
			}
		}
	}

	return bgImg
}

// jigsawMask builds a boolean mask for a square body with a right-side tab.
func jigsawMask(size, tabR, pieceW, pieceH int) []bool {
	mask := make([]bool, pieceW*pieceH)
	cxTab := size
	cyTab := size / 2
	tabR2 := tabR * tabR

	for y := 0; y < pieceH; y++ {
		for x := 0; x < pieceW; x++ {
			inBody := x >= 0 && x < size && y >= 0 && y < size
			dx := x - cxTab
			dy := y - cyTab
			inTab := dx*dx+dy*dy <= tabR2
			// Slight rounded corners on the body.
			corner := 4
			if inBody {
				if (x < corner && y < corner && (x-corner)*(x-corner)+(y-corner)*(y-corner) > corner*corner) ||
					(x < corner && y >= size-corner && (x-corner)*(x-corner)+(y-(size-1-corner))*(y-(size-1-corner)) > corner*corner) ||
					(x >= size-corner && y < corner && (x-(size-1-corner))*(x-(size-1-corner))+(y-corner)*(y-corner) > corner*corner) ||
					(x >= size-corner && y >= size-corner && (x-(size-1-corner))*(x-(size-1-corner))+(y-(size-1-corner))*(y-(size-1-corner)) > corner*corner) {
					inBody = false
				}
			}
			mask[y*pieceW+x] = inBody || inTab
		}
	}
	return mask
}

func strokeMask(img *image.RGBA, ox, oy int, mask []bool, w, h int, c color.RGBA, thickness int) {
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if !mask[y*w+x] {
				continue
			}
			if isMaskEdge(mask, w, h, x, y) {
				for dy := -thickness + 1; dy < thickness; dy++ {
					for dx := -thickness + 1; dx < thickness; dx++ {
						px, py := ox+x+dx, oy+y+dy
						if px >= 0 && px < img.Bounds().Dx() && py >= 0 && py < img.Bounds().Dy() {
							img.Set(px, py, c)
						}
					}
				}
			}
		}
	}
}

func strokePiece(img *image.RGBA, mask []bool, w, h int, c color.RGBA, thickness int) {
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if !mask[y*w+x] || !isMaskEdge(mask, w, h, x, y) {
				continue
			}
			for dy := -thickness + 1; dy < thickness; dy++ {
				for dx := -thickness + 1; dx < thickness; dx++ {
					px, py := x+dx, y+dy
					if px >= 0 && px < w && py >= 0 && py < h && mask[py*w+px] {
						img.Set(px, py, c)
					}
				}
			}
		}
	}
}

func isMaskEdge(mask []bool, w, h, x, y int) bool {
	for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
		nx, ny := x+d[0], y+d[1]
		if nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny*w+nx] {
			return true
		}
	}
	return false
}

func fillCircleSoft(img *image.RGBA, cx, cy, rad int, c color.RGBA, strength float64) {
	r2 := rad * rad
	for y := cy - rad; y <= cy+rad; y++ {
		for x := cx - rad; x <= cx+rad; x++ {
			if x < 0 || y < 0 || x >= img.Bounds().Dx() || y >= img.Bounds().Dy() {
				continue
			}
			dx, dy := x-cx, y-cy
			d2 := dx*dx + dy*dy
			if d2 > r2 {
				continue
			}
			t := 1 - math.Sqrt(float64(d2))/float64(rad)
			a := strength * t
			src := img.RGBAAt(x, y)
			img.Set(x, y, color.RGBA{
				clampByte(int(float64(src.R)*(1-a)+float64(c.R)*a), 0),
				clampByte(int(float64(src.G)*(1-a)+float64(c.G)*a), 0),
				clampByte(int(float64(src.B)*(1-a)+float64(c.B)*a), 0),
				255,
			})
		}
	}
}

// encodePNGDataURL encodes an image as a PNG data URL.
func encodePNGDataURL(img image.Image) (string, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}
