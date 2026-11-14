package middlewares

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"net"
	"net/http"
	"strings"
)

// APISecurity enforces the deployment's origin and TLS boundary. Forwarded TLS
// headers are trusted only from explicitly configured reverse-proxy networks.
func APISecurity(origins, proxyCIDRs string, requireHTTPS bool) (gin.HandlerFunc, error) {
	allowed := map[string]bool{}
	for _, origin := range strings.Split(origins, ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowed[origin] = true
		}
	}
	proxies := []*net.IPNet{}
	for _, cidr := range strings.Split(proxyCIDRs, ",") {
		cidr = strings.TrimSpace(cidr)
		if cidr == "" {
			continue
		}
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			return nil, fmt.Errorf("invalid TRUSTED_PROXY_CIDRS: %w", err)
		}
		proxies = append(proxies, network)
	}
	return func(c *gin.Context) {
		// The container probe has no credentials or business response.
		health := c.Request.Method == http.MethodGet && (c.Request.URL.Path == "/api/v1/health" || c.Request.URL.Path == "/health")
		secure := c.Request.TLS != nil
		host, _, _ := net.SplitHostPort(c.Request.RemoteAddr)
		for _, network := range proxies {
			if network.Contains(net.ParseIP(host)) && strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
				secure = true
			}
		}
		if requireHTTPS && !secure && !health {
			c.AbortWithStatusJSON(426, gin.H{"error": "HTTPS required", "code": "HTTPS_REQUIRED"})
			return
		}
		origin := c.GetHeader("Origin")
		if origin != "" {
			c.Header("Vary", "Origin")
			if !allowed[origin] {
				c.AbortWithStatusJSON(403, gin.H{"error": "Origin not allowed", "code": "ORIGIN_NOT_ALLOWED"})
				return
			}
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Client-Version, X-Request-ID, Idempotency-Key")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Expose-Headers", "X-Request-ID")
			if c.Request.Method == http.MethodOptions {
				c.AbortWithStatus(204)
				return
			}
		}
		c.Next()
	}, nil
}
