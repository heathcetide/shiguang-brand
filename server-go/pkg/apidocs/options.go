// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package apidocs

import (
	"github.com/danielgtaylor/huma/v2"
)

// Theme is the docs UI theme.
type Theme string

const (
	// ThemeScalar uses Scalar API Reference (modern, light/dark, customizable).
	// Default theme.
	ThemeScalar Theme = "scalar"

	// ThemeSwagger uses Swagger UI (classic, widely recognized).
	ThemeSwagger Theme = "swagger"

	// ThemeRedoc uses Redoc (clean, responsive, three-panel layout).
	ThemeRedoc Theme = "redoc"

	// ThemeStoplight uses Stoplight Elements (modern, good for design-first).
	ThemeStoplight Theme = "stoplight"
)

// CDNConfig controls where UI assets (JS/CSS) are loaded from.
//
// Default: public CDN (unpkg/jsdelivr). For offline/intranet deployment,
// set BaseURL to your self-hosted asset server, or set individual URLs.
//
// # Self-hosted example
//
//	apidocs.Mount(r, apidocs.Options{
//	    CDN: apidocs.CDNConfig{
//	        Mode:    apidocs.CDNModeSelfHosted,
//	        BaseURL: "https://assets.internal.company.com/openapi-ui",
//	    },
//	})
//
// This will load:
//   - Scalar:  <BaseURL>/scalar/api-reference.js
//   - Swagger: <BaseURL>/swagger-ui/swagger-ui-bundle.js
//   - Redoc:   <BaseURL>/redoc/redoc.standalone.js
//   - Stoplight: <BaseURL>/stoplight/elements.min.js
//
// You can also override individual asset URLs:
//
//	apidocs.Mount(r, apidocs.Options{
//	    CDN: apidocs.CDNConfig{
//	        Mode:          apidocs.CDNModeCustom,
//	        ScalarJS:      "https://cdn.mycompany.com/scalar.js",
//	        SwaggerJS:     "https://cdn.mycompany.com/swagger.js",
//	        SwaggerCSS:    "https://cdn.mycompany.com/swagger.css",
//	        RedocJS:       "https://cdn.mycompany.com/redoc.js",
//	        StoplightJS:   "https://cdn.mycompany.com/stoplight.js",
//	        StoplightCSS:  "https://cdn.mycompany.com/stoplight.css",
//	    },
//	})
type CDNConfig struct {
	// Mode controls how assets are loaded.
	// Default: CDNModePublic
	Mode CDNMode

	// BaseURL is the base URL for self-hosted assets.
	// Only used when Mode == CDNModeSelfHosted.
	// e.g. "https://assets.internal.company.com/openapi-ui"
	BaseURL string

	// ScalarJS is the URL for Scalar standalone JS.
	// If empty, uses default based on Mode.
	ScalarJS string

	// SwaggerJS is the URL for Swagger UI Bundle JS.
	SwaggerJS string

	// SwaggerCSS is the URL for Swagger UI CSS.
	SwaggerCSS string

	// RedocJS is the URL for Redoc standalone JS.
	RedocJS string

	// StoplightJS is the URL for Stoplight Elements JS.
	StoplightJS string

	// StoplightCSS is the URL for Stoplight Elements CSS.
	StoplightCSS string
}

// CDNMode controls how UI assets are loaded.
type CDNMode string

const (
	// CDNModePublic loads assets from public CDNs (unpkg, jsdelivr).
	// Default. Requires internet access.
	CDNModePublic CDNMode = "public"

	// CDNModeSelfHosted loads assets from a user-specified BaseURL.
	// For intranet/offline deployment.
	CDNModeSelfHosted CDNMode = "selfhosted"

	// CDNModeCustom uses individually specified URLs for each asset.
	CDNModeCustom CDNMode = "custom"
)

// TopBarConfig configures the top navigation bar.
//
// Set HideTopBar to true to completely remove the topbar and use the
// UI's native header. Set CustomHTML to fully replace the topbar.
type TopBarConfig struct {
	// HideTopBar removes the topbar entirely.
	// Default: false
	HideTopBar bool

	// CustomHTML replaces the entire topbar with user-provided HTML.
	// If set, all other TopBar fields are ignored.
	CustomHTML string

	// Subtitle is the text shown below the title.
	// Default: "接口文档"
	Subtitle string

	// ShowExportButtons controls whether JSON/YAML export buttons are shown.
	// Default: true. Set to false to hide.
	ShowExportButtons *bool

	// ExtraButtons is additional HTML for the actions area.
	// e.g. `<a class="apidocs-btn-ghost" href="/">返回首页</a>`
	ExtraButtons string

	// EnvLabel is an environment badge shown next to the title.
	// e.g. "DEV", "STAGING", "PROD"
	// If empty, no badge is shown.
	EnvLabel string

	// EnvLabelColor is the CSS color for the env badge.
	// Default: "#f59e0b" (amber)
	EnvLabelColor string
}

// Options configures the API docs surface.
type Options struct {
	// Title is the API title shown in the docs UI.
	// Default: "API"
	Title string

	// Version is the API version.
	// Default: "1.0.0"
	Version string

	// Description is the OpenAPI info description.
	// Supports Markdown.
	Description string

	// Contact is the API contact information.
	Contact *huma.Contact

	// License is the API license information.
	License *huma.License

	// TermsOfService is the URL to the terms of service.
	TermsOfService string

	// DocsPath is the path where the docs UI is served.
	// Default: "/docs"
	DocsPath string

	// APIPrefix is the API prefix for server URL display, e.g. "/api".
	// Optional. If set, the server URL shows the prefix.
	APIPrefix string

	// MetaPath is the path for the meta endpoint.
	// Default: "/api/v1/meta"
	MetaPath string

	// EnableMeta controls whether the meta endpoint is registered.
	// Default: true
	// Set to false to disable the meta endpoint entirely.
	EnableMeta *bool

	// EnabledFunc controls whether the docs UI is mounted at all.
	// If nil, docs are always enabled.
	// If it returns false:
	//   - The docs UI page (<DocsPath>) is NOT mounted
	//   - The meta endpoint is NOT mounted
	//   - /openapi.json and /openapi.yaml are NOT served (unless ExposeSpec is true)
	//   - huma.API is still returned so huma.Register works normally
	//
	// Use this for environment-based control, e.g. disable docs in production:
	//
	//	apidocs.Mount(r, apidocs.Options{
	//	    Title: "My API",
	//	    EnabledFunc: func() bool {
	//	        return os.Getenv("APP_ENV") != "prod"
	//	    },
	//	})
	//
	// Or with a config struct:
	//
	//	apidocs.Mount(r, apidocs.Options{
	//	    EnabledFunc: func() bool { return cfg.Env != "prod" },
	//	})
	EnabledFunc func() bool

	// ExposeSpec controls whether /openapi.json and /openapi.yaml are served
	// when EnabledFunc returns false.
	// Default: false (spec is hidden when docs are disabled).
	// Set to true to keep the spec accessible to tooling even when the
	// interactive docs UI is disabled.
	ExposeSpec *bool

	// Theme is the docs UI theme.
	// Default: ThemeScalar
	Theme Theme

	// DarkMode controls the docs UI dark mode.
	// Default: false (light mode)
	DarkMode bool

	// Logo is a PNG/JPG/SVG image served at <docsPath>/assets/logo.
	// If nil, a default logo is used.
	Logo []byte

	// LogoContentType is the MIME type for the logo, e.g. "image/png".
	// Default: "image/png" (or "image/svg+xml" for the default logo)
	LogoContentType string

	// CSS is custom CSS injected into the docs page.
	// If empty, a default theme CSS is used.
	CSS string

	// CustomJS is JavaScript injected at the end of <body>.
	// Useful for analytics, custom auth logic, etc.
	CustomJS string

	// CustomHeadHTML is injected into the <head> of the docs page.
	// Use for additional meta tags, preconnect, etc.
	CustomHeadHTML string

	// CDN controls where UI assets are loaded from.
	// Default: public CDN. Set to self-hosted for offline/intranet use.
	CDN CDNConfig

	// TopBar configures the top navigation bar.
	// Set HideTopBar to true to use the UI's native header instead.
	TopBar TopBarConfig

	// SecuritySchemes registers OpenAPI security schemes.
	// Key is the scheme name (e.g. "BearerAuth"), value is the scheme config.
	SecuritySchemes map[string]SecurityScheme

	// GlobalSecurity sets the default security requirement for all operations.
	// e.g. []map[string][]string{{"BearerAuth": {}}}
	GlobalSecurity []map[string][]string

	// Servers overrides the OpenAPI servers list.
	// If nil, a default server is generated from APIPrefix.
	Servers []*huma.Server

	// ExternalDocs is a link to external documentation.
	ExternalDocs *huma.ExternalDocs

	// ScalarConfig is additional Scalar-specific configuration.
	// Only used when Theme == ThemeScalar.
	// See: https://github.com/scalar/scalar/blob/main/docs/configuration.md
	ScalarConfig map[string]any

	// SwaggerConfig is additional Swagger UI configuration.
	// Only used when Theme == ThemeSwagger.
	// See: https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/
	SwaggerConfig map[string]any

	// RedocConfig is additional Redoc configuration.
	// Only used when Theme == ThemeRedoc.
	// See: https://redocly.com/docs/api-reference-docs/configuration/functions/
	RedocConfig map[string]any

	// StoplightConfig is additional Stoplight Elements configuration.
	// Only used when Theme == ThemeStoplight.
	StoplightConfig map[string]any
}

func (o *Options) applyDefaults() {
	if o.Title == "" {
		o.Title = "API"
	}
	if o.Version == "" {
		o.Version = "1.0.0"
	}
	if o.DocsPath == "" {
		o.DocsPath = "/docs"
	}
	if o.Theme == "" {
		o.Theme = ThemeScalar
	}
	if o.LogoContentType == "" && o.Logo != nil {
		o.LogoContentType = "image/png"
	}
	if o.EnableMeta == nil {
		t := true
		o.EnableMeta = &t
	}
	if o.CDN.Mode == "" {
		o.CDN.Mode = CDNModePublic
	}
	if o.TopBar.Subtitle == "" {
		o.TopBar.Subtitle = "接口文档"
	}
	if o.TopBar.EnvLabelColor == "" {
		o.TopBar.EnvLabelColor = "#f59e0b"
	}
	if o.TopBar.ShowExportButtons == nil {
		t := true
		o.TopBar.ShowExportButtons = &t
	}
}
