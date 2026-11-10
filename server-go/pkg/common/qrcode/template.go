// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package qrcode

import (
	"fmt"
	"image"
	"image/color"
	"os"
	"sync"
)

// TemplateCategory groups fancy QR style presets (mirrors product UI tabs).
type TemplateCategory string

const (
	// CategorySimple is 黑白简约 — monochrome module/finder styles.
	CategorySimple TemplateCategory = "simple"
	// CategoryClassic is 经典绚丽 — colorful gradients and vivid solids.
	CategoryClassic TemplateCategory = "classic"
	// CategoryCreative is 创意样式 — bolder shapes and multi-stop gradients.
	CategoryCreative TemplateCategory = "creative"
	// CategoryCustom is 我的模板 — user-registered presets via RegisterTemplate.
	CategoryCustom TemplateCategory = "custom"
)

// Template is a named FancyOptions preset that can be listed, selected, and
// applied in one call (GenerateFromTemplate).
type Template struct {
	// ID is a stable machine key (e.g. "simple-dots").
	ID string
	// Name is a human-readable label (often Chinese, matching UI copy).
	Name string
	// Category selects which gallery tab this template belongs to.
	Category TemplateCategory
	// Options are the visual parameters applied when generating.
	Options FancyOptions
	// Level is the default error-correction level. Zero means ECLHigh
	// (recommended for styled / logo QR codes).
	Level ErrorCorrectionLevel
}

// TemplateOverride patches a template at generate time (logo, size, etc.)
// without mutating the registered preset.
type TemplateOverride struct {
	Logo               image.Image
	LogoSizeMultiplier int
	LogoSafeZone       bool
	Halftone           image.Image
	ModuleWidth        uint8
	BorderWidth        int
	FgColor            color.Color
	BgColor            color.Color
	FgGradient         *LinearGradient
	BgTransparent      bool
}

var (
	templateMu   sync.RWMutex
	customByID   = map[string]Template{}
	builtinOrder []Template
)

func init() {
	builtinOrder = buildBuiltinTemplates()
}

// BuiltinTemplates returns a copy of all built-in style templates.
func BuiltinTemplates() []Template {
	out := make([]Template, len(builtinOrder))
	copy(out, builtinOrder)
	return out
}

// ListTemplates returns built-ins plus custom templates.
// Pass an empty category to list everything.
func ListTemplates(category TemplateCategory) []Template {
	templateMu.RLock()
	defer templateMu.RUnlock()

	var out []Template
	appendIf := func(t Template) {
		if category == "" || t.Category == category {
			out = append(out, t)
		}
	}
	for _, t := range builtinOrder {
		appendIf(t)
	}
	for _, t := range customByID {
		appendIf(t)
	}
	return out
}

// GetTemplate looks up a built-in or custom template by ID.
func GetTemplate(id string) (Template, bool) {
	if id == "" {
		return Template{}, false
	}
	for _, t := range builtinOrder {
		if t.ID == id {
			return t, true
		}
	}
	templateMu.RLock()
	defer templateMu.RUnlock()
	t, ok := customByID[id]
	return t, ok
}

// RegisterTemplate stores a custom template. Built-in IDs cannot be overwritten.
// Empty Category defaults to CategoryCustom.
func RegisterTemplate(t Template) error {
	if t.ID == "" {
		return fmt.Errorf("qrcode: template id is empty")
	}
	for _, b := range builtinOrder {
		if b.ID == t.ID {
			return fmt.Errorf("qrcode: template id %q is reserved", t.ID)
		}
	}
	if t.Category == "" {
		t.Category = CategoryCustom
	}
	templateMu.Lock()
	defer templateMu.Unlock()
	customByID[t.ID] = t
	return nil
}

// UnregisterTemplate removes a previously registered custom template.
func UnregisterTemplate(id string) {
	templateMu.Lock()
	defer templateMu.Unlock()
	delete(customByID, id)
}

// ClearCustomTemplates removes all user-registered templates.
func ClearCustomTemplates() {
	templateMu.Lock()
	defer templateMu.Unlock()
	customByID = map[string]Template{}
}

// GenerateFromTemplate applies a named template and returns PNG bytes.
func GenerateFromTemplate(text, templateID string, override ...TemplateOverride) ([]byte, error) {
	t, ok := GetTemplate(templateID)
	if !ok {
		return nil, fmt.Errorf("qrcode: unknown template %q", templateID)
	}
	opts := applyTemplateOverride(t.Options, override...)
	level := t.Level
	if level == 0 {
		level = ECLHigh
	}
	return GenerateFancy(text, level, opts)
}

// SaveFromTemplate generates a styled QR from a template and writes a PNG file.
func SaveFromTemplate(text, path, templateID string, override ...TemplateOverride) error {
	data, err := GenerateFromTemplate(text, templateID, override...)
	if err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("qrcode: create %s: %w", path, err)
	}
	defer f.Close()
	_, err = f.Write(data)
	return err
}

func applyTemplateOverride(base FancyOptions, overrides ...TemplateOverride) FancyOptions {
	if len(overrides) == 0 {
		return base
	}
	o := overrides[0]
	out := base
	if o.FgColor != nil {
		out.FgColor = o.FgColor
		out.FgGradient = nil
	}
	if o.BgColor != nil {
		out.BgColor = o.BgColor
	}
	if o.BgTransparent {
		out.BgTransparent = true
	}
	if o.FgGradient != nil {
		out.FgGradient = o.FgGradient
	}
	if o.Logo != nil {
		out.Logo = o.Logo
		if o.LogoSizeMultiplier > 0 {
			out.LogoSizeMultiplier = o.LogoSizeMultiplier
		}
		out.LogoSafeZone = out.LogoSafeZone || o.LogoSafeZone
	}
	if o.Halftone != nil {
		out.Halftone = o.Halftone
	}
	if o.ModuleWidth > 0 {
		out.ModuleWidth = o.ModuleWidth
	}
	if o.BorderWidth > 0 {
		out.BorderWidth = o.BorderWidth
	}
	return out
}

// ──────────────────────────────────────────────
// Built-in gallery (parametric styles)
// ──────────────────────────────────────────────

func rgba(r, g, b uint8) color.RGBA {
	return color.RGBA{R: r, G: g, B: b, A: 255}
}

func mono(module ModuleShape, finder FinderShape) FancyOptions {
	return FancyOptions{
		Module:      module,
		Finder:      finder,
		FgColor:     color.Black,
		BgColor:     color.White,
		ModuleWidth: 21,
		BorderWidth: 20,
	}
}

func solid(module ModuleShape, finder FinderShape, fg color.Color) FancyOptions {
	return FancyOptions{
		Module:      module,
		Finder:      finder,
		FgColor:     fg,
		BgColor:     color.White,
		ModuleWidth: 21,
		BorderWidth: 20,
	}
}

func gradient(module ModuleShape, finder FinderShape, angle float64, stops ...ColorStop) FancyOptions {
	return FancyOptions{
		Module:      module,
		Finder:      finder,
		FgGradient:  NewLinearGradient(angle, stops...),
		BgColor:     color.White,
		ModuleWidth: 21,
		BorderWidth: 20,
	}
}

func buildBuiltinTemplates() []Template {
	return []Template{
		// ── 黑白简约 ──
		{ID: "simple-dots", Name: "圆点", Category: CategorySimple, Options: mono(ShapeCircle, FinderRounded)},
		{ID: "simple-rounded", Name: "圆角块", Category: CategorySimple, Options: mono(ShapeRounded, FinderRounded)},
		{ID: "simple-liquid", Name: "液态", Category: CategorySimple, Options: mono(ShapeLiquid, FinderRounded)},
		{ID: "simple-diamond", Name: "菱形", Category: CategorySimple, Options: mono(ShapeDiamond, FinderSquare)},
		{ID: "simple-vstripe", Name: "竖胶囊", Category: CategorySimple, Options: mono(ShapeVStripe, FinderRounded)},
		{ID: "simple-hstripe", Name: "横条纹", Category: CategorySimple, Options: mono(ShapeHStripe, FinderRounded)},
		{ID: "simple-square", Name: "经典方块", Category: CategorySimple, Options: mono(ShapeRectangle, FinderSquare)},
		{ID: "simple-rounded-finder", Name: "圆角定位", Category: CategorySimple, Options: mono(ShapeRectangle, FinderRounded)},
		{ID: "simple-dots-square", Name: "圆点方定位", Category: CategorySimple, Options: mono(ShapeCircle, FinderSquare)},
		{ID: "simple-diamond-round", Name: "菱形圆定位", Category: CategorySimple, Options: mono(ShapeDiamond, FinderRounded)},
		{ID: "simple-liquid-square", Name: "液态方定位", Category: CategorySimple, Options: mono(ShapeLiquid, FinderSquare)},
		{ID: "simple-dense-dots", Name: "细密圆点", Category: CategorySimple, Options: FancyOptions{
			Module: ShapeCircle, Finder: FinderRounded, FgColor: color.Black, BgColor: color.White,
			ModuleWidth: 16, BorderWidth: 24,
		}},

		// ── 经典绚丽 ──
		{ID: "classic-ocean", Name: "海洋渐变", Category: CategoryClassic, Options: gradient(ShapeCircle, FinderRounded, 45,
			ColorStop{Color: rgba(30, 64, 175), T: 0},
			ColorStop{Color: rgba(14, 165, 233), T: 1},
		)},
		{ID: "classic-sunset", Name: "日落渐变", Category: CategoryClassic, Options: gradient(ShapeRounded, FinderRounded, 90,
			ColorStop{Color: rgba(234, 88, 12), T: 0},
			ColorStop{Color: rgba(251, 191, 36), T: 1},
		)},
		{ID: "classic-violet", Name: "紫霞渐变", Category: CategoryClassic, Options: gradient(ShapeCircle, FinderRounded, 135,
			ColorStop{Color: rgba(124, 58, 237), T: 0},
			ColorStop{Color: rgba(236, 72, 153), T: 1},
		)},
		{ID: "classic-forest", Name: "森林绿", Category: CategoryClassic, Options: solid(ShapeLiquid, FinderRounded, rgba(22, 101, 52))},
		{ID: "classic-ruby", Name: "宝石红", Category: CategoryClassic, Options: solid(ShapeDiamond, FinderSquare, rgba(185, 28, 28))},
		{ID: "classic-sky", Name: "天空蓝", Category: CategoryClassic, Options: solid(ShapeCircle, FinderRounded, rgba(2, 132, 199))},
		{ID: "classic-candy", Name: "糖果渐变", Category: CategoryClassic, Options: gradient(ShapeRounded, FinderRounded, 0,
			ColorStop{Color: rgba(244, 63, 94), T: 0},
			ColorStop{Color: rgba(251, 146, 60), T: 0.5},
			ColorStop{Color: rgba(250, 204, 21), T: 1},
		)},
		{ID: "classic-aurora", Name: "极光", Category: CategoryClassic, Options: gradient(ShapeVStripe, FinderRounded, 60,
			ColorStop{Color: rgba(16, 185, 129), T: 0},
			ColorStop{Color: rgba(59, 130, 246), T: 0.5},
			ColorStop{Color: rgba(139, 92, 246), T: 1},
		)},
		{ID: "classic-ink-blue", Name: "墨蓝", Category: CategoryClassic, Options: solid(ShapeHStripe, FinderRounded, rgba(30, 58, 138))},
		{ID: "classic-coral", Name: "珊瑚橙", Category: CategoryClassic, Options: solid(ShapeRounded, FinderRounded, rgba(249, 115, 22))},
		{ID: "classic-mint", Name: "薄荷绿", Category: CategoryClassic, Options: gradient(ShapeCircle, FinderRounded, 45,
			ColorStop{Color: rgba(13, 148, 136), T: 0},
			ColorStop{Color: rgba(52, 211, 153), T: 1},
		)},
		{ID: "classic-grape", Name: "葡萄紫", Category: CategoryClassic, Options: solid(ShapeDiamond, FinderRounded, rgba(109, 40, 217))},

		// ── 创意样式 ──
		{ID: "creative-neon", Name: "霓虹", Category: CategoryCreative, Options: gradient(ShapeVStripe, FinderRounded, 90,
			ColorStop{Color: rgba(217, 70, 239), T: 0},
			ColorStop{Color: rgba(34, 211, 238), T: 1},
		)},
		{ID: "creative-fire", Name: "火焰", Category: CategoryCreative, Options: gradient(ShapeLiquid, FinderRounded, 270,
			ColorStop{Color: rgba(127, 29, 29), T: 0},
			ColorStop{Color: rgba(239, 68, 68), T: 0.45},
			ColorStop{Color: rgba(251, 191, 36), T: 1},
		)},
		{ID: "creative-ice", Name: "寒冰", Category: CategoryCreative, Options: gradient(ShapeDiamond, FinderSquare, 45,
			ColorStop{Color: rgba(12, 74, 110), T: 0},
			ColorStop{Color: rgba(125, 211, 252), T: 1},
		)},
		{ID: "creative-matrix", Name: "矩阵绿", Category: CategoryCreative, Options: FancyOptions{
			Module: ShapeRectangle, Finder: FinderSquare, FgColor: rgba(22, 163, 74), BgColor: rgba(5, 46, 22),
			ModuleWidth: 18, BorderWidth: 16,
		}},
		{ID: "creative-night", Name: "暗夜", Category: CategoryCreative, Options: FancyOptions{
			Module: ShapeCircle, Finder: FinderRounded, FgColor: rgba(226, 232, 240), BgColor: rgba(15, 23, 42),
			ModuleWidth: 21, BorderWidth: 20,
		}},
		{ID: "creative-gold", Name: "鎏金", Category: CategoryCreative, Options: gradient(ShapeRounded, FinderRounded, 135,
			ColorStop{Color: rgba(120, 53, 15), T: 0},
			ColorStop{Color: rgba(234, 179, 8), T: 0.55},
			ColorStop{Color: rgba(254, 243, 199), T: 1},
		)},
		{ID: "creative-wave", Name: "浪潮", Category: CategoryCreative, Options: gradient(ShapeHStripe, FinderRounded, 0,
			ColorStop{Color: rgba(29, 78, 216), T: 0},
			ColorStop{Color: rgba(6, 182, 212), T: 1},
		)},
		{ID: "creative-berry", Name: "浆果", Category: CategoryCreative, Options: gradient(ShapeCircle, FinderRounded, 45,
			ColorStop{Color: rgba(157, 23, 77), T: 0},
			ColorStop{Color: rgba(244, 63, 94), T: 0.5},
			ColorStop{Color: rgba(251, 113, 133), T: 1},
		)},
		{ID: "creative-lime", Name: "青柠", Category: CategoryCreative, Options: solid(ShapeVStripe, FinderRounded, rgba(101, 163, 13))},
		{ID: "creative-steel", Name: "钢铁", Category: CategoryCreative, Options: FancyOptions{
			Module: ShapeLiquid, Finder: FinderSquare, FgColor: rgba(71, 85, 105), BgColor: color.White,
			ModuleWidth: 21, BorderWidth: 20,
		}},
		{ID: "creative-sakura", Name: "樱粉", Category: CategoryCreative, Options: gradient(ShapeRounded, FinderRounded, 60,
			ColorStop{Color: rgba(219, 39, 119), T: 0},
			ColorStop{Color: rgba(251, 207, 232), T: 1},
		)},
		{ID: "creative-cosmos", Name: "星云", Category: CategoryCreative, Options: FancyOptions{
			Module: ShapeDiamond, Finder: FinderRounded,
			FgGradient: NewLinearGradient(120,
				ColorStop{Color: rgba(49, 46, 129), T: 0},
				ColorStop{Color: rgba(139, 92, 246), T: 0.5},
				ColorStop{Color: rgba(244, 114, 182), T: 1},
			),
			BgColor: color.White, ModuleWidth: 21, BorderWidth: 20,
		}},
	}
}
