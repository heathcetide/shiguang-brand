// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package apidocs

import (
	_ "embed"
	"encoding/json"
	"html"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ──────────────────────────────────────────────
// Embedded default assets
// ──────────────────────────────────────────────

//go:embed assets/default.css
var defaultCSS string

//go:embed assets/logo.svg
var defaultLogoSVG []byte

//go:embed assets/logo.png
var defaultLogoPNG []byte

// ──────────────────────────────────────────────
// CDN asset URLs
// ──────────────────────────────────────────────

// Default public CDN URLs.
const (
	cdnScalarJS     = "https://unpkg.com/@scalar/api-reference@1.44.20/dist/browser/standalone.js"
	cdnSwaggerJS    = "https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"
	cdnSwaggerCSS   = "https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css"
	cdnRedocJS      = "https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"
	cdnStoplightJS  = "https://unpkg.com/@stoplight/elements@8.3.0/web-components.min.js"
	cdnStoplightCSS = "https://unpkg.com/@stoplight/elements@8.3.0/styles.min.css"
)

// Self-hosted asset paths (relative to BaseURL).
const (
	selfHostedScalarJS     = "/scalar/api-reference.js"
	selfHostedSwaggerJS    = "/swagger-ui/swagger-ui-bundle.js"
	selfHostedSwaggerCSS   = "/swagger-ui/swagger-ui.css"
	selfHostedRedocJS      = "/redoc/redoc.standalone.js"
	selfHostedStoplightJS  = "/stoplight/elements.min.js"
	selfHostedStoplightCSS = "/stoplight/styles.min.css"
)

// assetURLs holds the resolved JS/CSS URLs for the selected theme.
type assetURLs struct {
	scalarJS     string
	swaggerJS    string
	swaggerCSS   string
	redocJS      string
	stoplightJS  string
	stoplightCSS string
}

func resolveAssetURLs(cdn CDNConfig) assetURLs {
	u := assetURLs{
		scalarJS:     cdnScalarJS,
		swaggerJS:    cdnSwaggerJS,
		swaggerCSS:   cdnSwaggerCSS,
		redocJS:      cdnRedocJS,
		stoplightJS:  cdnStoplightJS,
		stoplightCSS: cdnStoplightCSS,
	}

	switch cdn.Mode {
	case CDNModeSelfHosted:
		base := strings.TrimSuffix(cdn.BaseURL, "/")
		if base == "" {
			base = "/assets"
		}
		u.scalarJS = base + selfHostedScalarJS
		u.swaggerJS = base + selfHostedSwaggerJS
		u.swaggerCSS = base + selfHostedSwaggerCSS
		u.redocJS = base + selfHostedRedocJS
		u.stoplightJS = base + selfHostedStoplightJS
		u.stoplightCSS = base + selfHostedStoplightCSS
	case CDNModeCustom:
		if cdn.ScalarJS != "" {
			u.scalarJS = cdn.ScalarJS
		}
		if cdn.SwaggerJS != "" {
			u.swaggerJS = cdn.SwaggerJS
		}
		if cdn.SwaggerCSS != "" {
			u.swaggerCSS = cdn.SwaggerCSS
		}
		if cdn.RedocJS != "" {
			u.redocJS = cdn.RedocJS
		}
		if cdn.StoplightJS != "" {
			u.stoplightJS = cdn.StoplightJS
		}
		if cdn.StoplightCSS != "" {
			u.stoplightCSS = cdn.StoplightCSS
		}
	}

	// Individual overrides always take precedence (even in public/selfhosted mode).
	if cdn.ScalarJS != "" && cdn.Mode != CDNModeCustom {
		u.scalarJS = cdn.ScalarJS
	}
	if cdn.SwaggerJS != "" && cdn.Mode != CDNModeCustom {
		u.swaggerJS = cdn.SwaggerJS
	}
	if cdn.SwaggerCSS != "" && cdn.Mode != CDNModeCustom {
		u.swaggerCSS = cdn.SwaggerCSS
	}
	if cdn.RedocJS != "" && cdn.Mode != CDNModeCustom {
		u.redocJS = cdn.RedocJS
	}
	if cdn.StoplightJS != "" && cdn.Mode != CDNModeCustom {
		u.stoplightJS = cdn.StoplightJS
	}
	if cdn.StoplightCSS != "" && cdn.Mode != CDNModeCustom {
		u.stoplightCSS = cdn.StoplightCSS
	}

	return u
}

// ──────────────────────────────────────────────
// UI renderer
// ──────────────────────────────────────────────

type uiRenderer struct {
	opts       Options
	css        string
	logo       []byte
	logoCT     string
	docsPath   string
	openAPIRef string
	assets     assetURLs
}

func newUIRenderer(opts Options) *uiRenderer {
	css := opts.CSS
	if css == "" {
		css = defaultCSS
	}
	logo := opts.Logo
	logoCT := opts.LogoContentType
	if logo == nil {
		logo = defaultLogoPNG
		logoCT = "image/png"
	}

	docsPath := strings.TrimSuffix(opts.DocsPath, "/")

	return &uiRenderer{
		opts:       opts,
		css:        css,
		logo:       logo,
		logoCT:     logoCT,
		docsPath:   docsPath,
		openAPIRef: "/openapi.json",
		assets:     resolveAssetURLs(opts.CDN),
	}
}

func (u *uiRenderer) mount(r *gin.Engine) {
	cssPath := u.docsPath + "/assets/docs.css"
	logoPath := u.docsPath + "/assets/logo"

	r.GET(cssPath, func(c *gin.Context) {
		c.Header("Content-Type", "text/css; charset=utf-8")
		c.Header("Cache-Control", "public, max-age=300")
		c.String(http.StatusOK, u.css)
	})

	r.GET(logoPath, func(c *gin.Context) {
		c.Header("Content-Type", u.logoCT)
		c.Header("Cache-Control", "public, max-age=86400")
		c.Data(http.StatusOK, u.logoCT, u.logo)
	})

	htmlPage := u.renderHTML()

	handler := func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Header("Cache-Control", "no-store")
		c.String(http.StatusOK, htmlPage)
	}
	r.GET(u.docsPath, handler)
	r.GET(u.docsPath+"/", handler)
}

func (u *uiRenderer) renderHTML() string {
	escTitle := html.EscapeString(u.opts.Title)
	escCSS := html.EscapeString(u.docsPath + "/assets/docs.css")
	escLogo := html.EscapeString(u.docsPath + "/assets/logo")
	escRef := html.EscapeString(u.openAPIRef)

	var body string
	switch u.opts.Theme {
	case ThemeSwagger:
		body = u.swaggerHTML(escRef, escTitle)
	case ThemeRedoc:
		body = u.redocHTML(escRef, escTitle)
	case ThemeStoplight:
		body = u.stoplightHTML(escRef, escTitle)
	default:
		body = u.scalarHTML(escRef, escTitle)
	}

	topbar := u.renderTopBar(escTitle, escLogo, escRef)

	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="` + darkModeAttr(u.opts.DarkMode) + `" />
  <meta name="referrer" content="no-referrer" />
  <title>` + escTitle + ` · API</title>
  <link rel="stylesheet" href="` + escCSS + `" />
  <link rel="icon" href="` + escLogo + `" />
  ` + u.opts.CustomHeadHTML + `
</head>
<body class="apidocs-body">
` + topbar + `
  <main class="apidocs-main">
` + body + `
  </main>
` + u.customJS() + `
</body>
</html>`
}

// renderTopBar builds the top navigation bar HTML.
func (u *uiRenderer) renderTopBar(title, logo, ref string) string {
	tb := u.opts.TopBar
	if tb.HideTopBar {
		return ""
	}
	if tb.CustomHTML != "" {
		return tb.CustomHTML
	}

	escTitle := title
	escLogo := logo
	escRef := ref
	escSubtitle := html.EscapeString(tb.Subtitle)

	envBadge := ""
	if tb.EnvLabel != "" {
		envBadge = ` <span class="apidocs-env-badge" style="background:` +
			html.EscapeString(tb.EnvLabelColor) + `">` +
			html.EscapeString(tb.EnvLabel) + `</span>`
	}

	exportButtons := ""
	if tb.ShowExportButtons != nil && *tb.ShowExportButtons {
		exportButtons = `
      <a class="apidocs-btn-ghost" href="` + escRef + `" download="openapi.json">导出 JSON</a>
      <a class="apidocs-btn-ghost" href="/openapi.yaml" download="openapi.yaml">导出 YAML</a>`
	}

	extraButtons := ""
	if tb.ExtraButtons != "" {
		extraButtons = "\n      " + tb.ExtraButtons
	}

	return `  <header class="apidocs-topbar">
    <div class="apidocs-brand">
      <img class="apidocs-logo" src="` + escLogo + `" alt="" width="28" height="28" />
      <div class="apidocs-brand-text">
        <strong id="apidocs-name">` + escTitle + envBadge + `</strong>
        <span>` + escSubtitle + `</span>
      </div>
    </div>
    <div class="apidocs-actions">` + exportButtons + extraButtons + `
    </div>
  </header>`
}

func (u *uiRenderer) customJS() string {
	if u.opts.CustomJS == "" {
		return ""
	}
	return `  <script>
` + u.opts.CustomJS + `
  </script>`
}

func darkModeAttr(dark bool) string {
	if dark {
		return "dark light"
	}
	return "light"
}

func darkModeStr(dark bool) string {
	if dark {
		return "dark"
	}
	return "light"
}

// ──────────────────────────────────────────────
// Scalar UI
// ──────────────────────────────────────────────

func (u *uiRenderer) scalarHTML(ref, title string) string {
	cfg := u.scalarConfig()
	cfgBytes, _ := json.Marshal(cfg)
	cfgJSON := string(cfgBytes)
	return `    <script id="api-reference" data-url="` + ref + `" data-configuration="` + html.EscapeString(cfgJSON) + `"></script>
    <script src="` + u.assets.scalarJS + `" crossorigin></script>`
}

func (u *uiRenderer) scalarConfig() map[string]any {
	cfg := map[string]any{
		"theme":              "default",
		"layout":             "modern",
		"darkMode":           u.opts.DarkMode,
		"forceDarkModeState": darkModeStr(u.opts.DarkMode),
		"hideModels":         false,
		"hideDownloadButton": true,
		"persistAuth":        true,
		"showSidebar":        true,
		"metaData": map[string]any{
			"title": u.opts.Title + " · API",
		},
		"agent": map[string]any{"disabled": true},
	}
	for k, v := range u.opts.ScalarConfig {
		cfg[k] = v
	}
	return cfg
}

// ──────────────────────────────────────────────
// Swagger UI
// ──────────────────────────────────────────────

func (u *uiRenderer) swaggerHTML(ref, title string) string {
	cfg := map[string]any{
		"url":         ref,
		"dom_id":      "#swagger-ui",
		"deepLinking": true,
		"presets":     []string{"SwaggerUIBundle.presets.apis", "SwaggerUIBundle.SwaggerUIStandalonePreset"},
		"plugins":     []string{"SwaggerUIBundle.plugins.DownloadUrl"},
		"layout":      "StandaloneLayout",
	}
	if u.opts.DarkMode {
		cfg["theme"] = "dark"
	}
	for k, v := range u.opts.SwaggerConfig {
		cfg[k] = v
	}

	// Build config JS object.
	cfgJS := swaggerConfigJS(cfg)

	return `    <div id="swagger-ui"></div>
    <link rel="stylesheet" href="` + u.assets.swaggerCSS + `" />
    <script src="` + u.assets.swaggerJS + `"></script>
    <script>
      window.onload = function() {
        window.ui = SwaggerUIBundle(` + cfgJS + `);
      };
    </script>`
}

// swaggerConfigJS renders a Go map as a JS object literal.
// Presets/plugins are special-cased as SwaggerUIBundle references.
func swaggerConfigJS(cfg map[string]any) string {
	var b strings.Builder
	b.WriteString("{\n")
	first := true
	for k, v := range cfg {
		if !first {
			b.WriteString(",\n")
		}
		first = false
		b.WriteString("        ")
		b.WriteString(jsonKey(k))
		b.WriteString(": ")
		b.WriteString(swaggerVal(v))
	}
	b.WriteString("\n      }")
	return b.String()
}

func jsonKey(k string) string {
	b, _ := json.Marshal(k)
	return string(b)
}

func swaggerVal(v any) string {
	switch val := v.(type) {
	case string:
		b, _ := json.Marshal(val)
		return string(b)
	case bool:
		if val {
			return "true"
		}
		return "false"
	case []string:
		if len(val) == 0 {
			return "[]"
		}
		// Special-case Swagger preset/plugin names.
		parts := make([]string, len(val))
		for i, s := range val {
			if strings.HasPrefix(s, "SwaggerUIBundle.") {
				parts[i] = s
			} else {
				b, _ := json.Marshal(s)
				parts[i] = string(b)
			}
		}
		return "[" + strings.Join(parts, ", ") + "]"
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

// ──────────────────────────────────────────────
// Redoc
// ──────────────────────────────────────────────

func (u *uiRenderer) redocHTML(ref, title string) string {
	attrs := []string{`spec-url="` + ref + `"`}
	for k, v := range u.opts.RedocConfig {
		attrs = append(attrs, k+`="`+redocAttrVal(v)+`"`)
	}
	return `    <redoc ` + strings.Join(attrs, " ") + `></redoc>
    <script src="` + u.assets.redocJS + `"></script>`
}

func redocAttrVal(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

// ──────────────────────────────────────────────
// Stoplight Elements
// ──────────────────────────────────────────────

func (u *uiRenderer) stoplightHTML(ref, title string) string {
	attrs := []string{
		`apiDescriptionUrl="` + ref + `"`,
		`router="hash"`,
		`layout="sidebar"`,
		`tryItCredentialsPolicy="include"`,
	}
	for k, v := range u.opts.StoplightConfig {
		attrs = append(attrs, k+`="`+redocAttrVal(v)+`"`)
	}
	return `    <elements-api ` + strings.Join(attrs, " ") + `></elements-api>
    <link rel="stylesheet" href="` + u.assets.stoplightCSS + `" />
    <script src="` + u.assets.stoplightJS + `"></script>`
}
