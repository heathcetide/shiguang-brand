// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package apidocs provides a reusable wrapper around Huma (OpenAPI 3.1)
// for quickly mounting API documentation on a Gin engine.
//
// Features:
//   - One-line mount: apidocs.Mount(r, apidocs.Options{...})
//   - Multiple UI themes: Scalar (default), Swagger UI, Redoc, Stoplight
//   - CDN + self-hosted asset modes (for offline/intranet deployment)
//   - Custom CSS / JS / logo / branding / topbar
//   - Security scheme helpers (Bearer, APIKey, OAuth2, OpenID Connect)
//   - Meta endpoint for doc discovery
//   - OpenAPI JSON/YAML export
//
// # Quick start
//
//	r := gin.New()
//	api := apidocs.Mount(r, apidocs.Options{
//	    Title:   "My API",
//	    Version: "1.0.0",
//	})
//	// Register routes with huma.Register(api, ...)
//	huma.Register(api, huma.Operation{
//	    Method: http.MethodGet,
//	    Path:   "/hello",
//	}, func(ctx context.Context, _ *struct{}) (*HelloOutput, error) {
//	    return &HelloOutput{Body: struct{ Msg string `json:"msg"` }{Msg: "hi"}}, nil
//	})
//
// # Self-hosted assets (offline/intranet)
//
//	api := apidocs.Mount(r, apidocs.Options{
//	    Title:   "Internal API",
//	    Version: "1.0.0",
//	    CDN: apidocs.CDNConfig{
//	        Mode:    apidocs.CDNModeSelfHosted,
//	        BaseURL: "https://assets.internal.company.com/openapi-ui",
//	    },
//	})
package apidocs

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humagin"
	"github.com/gin-gonic/gin"
)

// Mount wires Huma OpenAPI 3.1 onto the Gin engine with a customizable
// docs UI. Returns the huma.API for registering typed operations.
func Mount(r *gin.Engine, opts Options) huma.API {
	opts.applyDefaults()

	// Determine if docs should be enabled.
	docsEnabled := true
	if opts.EnabledFunc != nil {
		docsEnabled = opts.EnabledFunc()
	}

	// Determine if the OpenAPI spec should be exposed.
	specEnabled := docsEnabled
	if opts.ExposeSpec != nil {
		specEnabled = *opts.ExposeSpec
	}

	cfg := huma.DefaultConfig(opts.Title, opts.Version)
	// Disable built-in docs — we serve our own customizable UI.
	cfg.DocsPath = ""
	if specEnabled {
		cfg.OpenAPIPath = "/openapi"
		cfg.SchemasPath = "/schemas"
	} else {
		// Hide the spec entirely.
		cfg.OpenAPIPath = ""
		cfg.SchemasPath = ""
	}

	if opts.Description != "" {
		cfg.Info.Description = opts.Description
	}
	if opts.Contact != nil {
		cfg.Info.Contact = opts.Contact
	}
	if opts.License != nil {
		cfg.Info.License = opts.License
	}
	if opts.TermsOfService != "" {
		cfg.Info.TermsOfService = opts.TermsOfService
	}
	if opts.ExternalDocs != nil {
		cfg.ExternalDocs = opts.ExternalDocs
	}
	if len(opts.Servers) > 0 {
		cfg.Servers = opts.Servers
	} else if opts.APIPrefix != "" {
		cfg.Servers = []*huma.Server{{
			URL:         "/",
			Description: "API prefix: " + opts.APIPrefix,
		}}
	}

	api := humagin.New(r, cfg)

	// Apply global security after API creation.
	if len(opts.GlobalSecurity) > 0 {
		api.OpenAPI().Security = opts.GlobalSecurity
	}

	// Register security schemes directly on the OpenAPI spec.
	if len(opts.SecuritySchemes) > 0 {
		if api.OpenAPI().Components == nil {
			api.OpenAPI().Components = &huma.Components{}
		}
		if api.OpenAPI().Components.SecuritySchemes == nil {
			api.OpenAPI().Components.SecuritySchemes = make(map[string]*huma.SecurityScheme)
		}
		for name, scheme := range opts.SecuritySchemes {
			api.OpenAPI().Components.SecuritySchemes[name] = scheme.toHuma()
		}
	}

	// Only mount docs UI and meta endpoint when enabled.
	if docsEnabled {
		ui := newUIRenderer(opts)
		ui.mount(r)

		if opts.EnableMeta != nil && *opts.EnableMeta {
			mountMeta(api, opts)
		}
	}

	return api
}

// mountMeta registers a meta endpoint that returns doc metadata.
func mountMeta(api huma.API, opts Options) {
	type metaBody struct {
		Name        string `json:"name" example:"My API" doc:"API name"`
		Version     string `json:"version" example:"1.0.0" doc:"API version"`
		DocsPath    string `json:"docs_path" doc:"Interactive docs UI path"`
		OpenAPIJSON string `json:"openapi_json" example:"/openapi.json" doc:"OpenAPI 3.1 JSON"`
		OpenAPIYAML string `json:"openapi_yaml" example:"/openapi.yaml" doc:"OpenAPI 3.1 YAML"`
		Theme       string `json:"theme" doc:"UI theme"`
	}
	type metaOutput struct {
		Body metaBody
	}

	metaPath := opts.MetaPath
	if metaPath == "" {
		metaPath = "/api/v1/meta"
	}

	huma.Register(api, huma.Operation{
		OperationID:   "get-api-meta",
		Method:        http.MethodGet,
		Path:          metaPath,
		Summary:       "文档元数据",
		Description:   "返回 OpenAPI 导出地址与文档入口，便于集成方发现文档。",
		Tags:          []string{"元信息"},
		DefaultStatus: http.StatusOK,
	}, func(ctx context.Context, _ *struct{}) (*metaOutput, error) {
		return &metaOutput{
			Body: metaBody{
				Name:        opts.Title,
				Version:     opts.Version,
				DocsPath:    opts.DocsPath,
				OpenAPIJSON: "/openapi.json",
				OpenAPIYAML: "/openapi.yaml",
				Theme:       string(opts.Theme),
			},
		}, nil
	})
}

// SecurityScheme defines an OpenAPI security scheme.
//
// For OAuth2, set Type="oauth2" and Flows.
// For OpenID Connect, set Type="openIdConnect" and OpenIDConnectURL.
type SecurityScheme struct {
	// Type is the scheme type: "http", "apiKey", "oauth2", "openIdConnect", "mutualTLS".
	Type string

	// Scheme is the HTTP auth scheme: "bearer", "basic".
	// Required when Type == "http".
	Scheme string

	// In is where the API key is located: "header", "query", "cookie".
	// Required when Type == "apiKey".
	In string

	// Name is the header/query parameter name for apiKey.
	// Required when Type == "apiKey".
	Name string

	// BearerFormat is the format hint for bearer tokens, e.g. "JWT".
	BearerFormat string

	// Flows is the OAuth2 flow configuration.
	// Required when Type == "oauth2".
	Flows *huma.OAuthFlows

	// OpenIDConnectURL is the OpenID Connect discovery URL.
	// Required when Type == "openIdConnect".
	OpenIDConnectURL string

	// Description is a human-readable description.
	Description string
}

func (s SecurityScheme) toHuma() *huma.SecurityScheme {
	return &huma.SecurityScheme{
		Type:             s.Type,
		Scheme:           s.Scheme,
		In:               s.In,
		Name:             s.Name,
		BearerFormat:     s.BearerFormat,
		Flows:            s.Flows,
		OpenIDConnectURL: s.OpenIDConnectURL,
		Description:      s.Description,
	}
}

// EnsureTag ensures a tag exists in the OpenAPI spec with a description.
func EnsureTag(api huma.API, name, description string) {
	if description == "" {
		description = name
	}
	for _, t := range api.OpenAPI().Tags {
		if t.Name == name {
			return
		}
	}
	api.OpenAPI().Tags = append(api.OpenAPI().Tags, &huma.Tag{
		Name:        name,
		Description: description,
	})
}
