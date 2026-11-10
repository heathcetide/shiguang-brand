// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package humax

import (
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

// document registers a route on the Huma OpenAPI document.
func document(api huma.API, method, ginPath string) {
	if api == nil {
		return
	}
	oapiPath := GinPathToOpenAPI(ginPath)
	params := pathParams(oapiPath)

	tag := tagFromPath(oapiPath)
	ensureTag(api, tag)

	op := &huma.Operation{
		OperationID:   OperationID(method, oapiPath),
		Method:        method,
		Path:          oapiPath,
		Summary:       summaryFromPath(method, oapiPath),
		Description:   descriptionFromPath(method, oapiPath),
		Tags:          []string{tag},
		Parameters:    params,
		DefaultStatus: http.StatusOK,
		Responses: map[string]*huma.Response{
			"200": {Description: "成功"},
			"201": {Description: "已创建"},
			"204": {Description: "无内容"},
			"400": {Description: "请求参数错误"},
			"401": {Description: "未授权"},
			"403": {Description: "无权限"},
			"404": {Description: "资源不存在"},
			"500": {Description: "服务器内部错误"},
		},
	}

	// huma.Register 会检查 path 是否已存在；用低层 OpenAPI 直接添加
	// 避免和 Gin 路由冲突。
	addPathItem(api, op)
}

// pathParams extracts {id} style path parameters for OpenAPI.
func pathParams(oapiPath string) []*huma.Param {
	var params []*huma.Param
	parts := strings.Split(oapiPath, "/")
	for _, part := range parts {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			name := part[1 : len(part)-1]
			params = append(params, &huma.Param{
				Name:     name,
				In:       "path",
				Required: true,
				Schema:   &huma.Schema{Type: "integer"},
			})
		}
	}
	return params
}

// tagFromPath derives an OpenAPI tag from the first path segment.
func tagFromPath(oapiPath string) string {
	parts := strings.Split(strings.Trim(oapiPath, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return "系统"
	}
	first := parts[0]
	switch first {
	case "health", "live", "ready":
		return "系统"
	case "api":
		if len(parts) > 2 {
			return humanizeTag(parts[2])
		}
		return "系统"
	default:
		return humanizeTag(first)
	}
}

func humanizeTag(s string) string {
	if s == "" {
		return "系统"
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// summaryFromPath generates a human-readable summary.
func summaryFromPath(method, oapiPath string) string {
	return method + " " + oapiPath
}

// descriptionFromPath generates a description.
func descriptionFromPath(method, oapiPath string) string {
	return method + " " + oapiPath
}

// ensureTag adds a tag to the OpenAPI spec if not present.
func ensureTag(api huma.API, name string) {
	if api == nil || api.OpenAPI() == nil {
		return
	}
	tags := api.OpenAPI().Tags
	for _, t := range tags {
		if t.Name == name {
			return
		}
	}
	api.OpenAPI().Tags = append(api.OpenAPI().Tags, &huma.Tag{Name: name})
}

// addPathItem adds an operation to the OpenAPI Paths map without
// triggering Huma's Gin route registration.
func addPathItem(api huma.API, op *huma.Operation) {
	if api == nil || api.OpenAPI() == nil {
		return
	}
	oapi := api.OpenAPI()
	if oapi.Paths == nil {
		oapi.Paths = map[string]*huma.PathItem{}
	}
	pi, ok := oapi.Paths[op.Path]
	if !ok {
		pi = &huma.PathItem{}
		oapi.Paths[op.Path] = pi
	}
	switch op.Method {
	case http.MethodGet:
		pi.Get = op
	case http.MethodPost:
		pi.Post = op
	case http.MethodPut:
		pi.Put = op
	case http.MethodPatch:
		pi.Patch = op
	case http.MethodDelete:
		pi.Delete = op
	}
}
