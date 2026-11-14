// Copyright (c) 2026 heathcetide. All rights reserved.

package handlers

import (
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"go.uber.org/zap"
)

// NewExpressProxy builds a reverse proxy to the Express strangler upstream.
// Returns nil when upstream URL is empty or invalid.
func NewExpressProxy(expressURL string) (*httputil.ReverseProxy, error) {
	expressURL = strings.TrimSpace(expressURL)
	if expressURL == "" {
		return nil, nil
	}
	target, err := url.Parse(expressURL)
	if err != nil {
		return nil, err
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 0,
	}
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
		if req.Header.Get("X-Forwarded-Host") == "" && req.Header.Get("Host") != "" {
			req.Header.Set("X-Forwarded-Host", req.Header.Get("Host"))
		}
		req.Header.Set("X-Forwarded-Proto", "http")
		if fwd := req.Header.Get("X-Forwarded-For"); fwd == "" {
			if host, _, err := net.SplitHostPort(req.RemoteAddr); err == nil {
				req.Header.Set("X-Forwarded-For", host)
			}
		}
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		if logger.Lg != nil {
			logger.Lg.Error("express upstream proxy error",
				zap.String("path", r.URL.Path),
				zap.Error(err))
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"message":"上游 Express 服务不可用","code":"UPSTREAM_UNAVAILABLE"}`))
	}
	return proxy, nil
}

// ProxyToExpress forwards unmatched requests to Express.
func ProxyToExpress(proxy *httputil.ReverseProxy) gin.HandlerFunc {
	return func(c *gin.Context) {
		if proxy == nil {
			c.JSON(http.StatusBadGateway, gin.H{
				"message": "上游 Express 未配置",
				"code":    "UPSTREAM_UNCONFIGURED",
			})
			return
		}
		proxy.ServeHTTP(c.Writer, c.Request)
	}
}
