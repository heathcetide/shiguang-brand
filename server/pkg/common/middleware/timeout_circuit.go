// Copyright (c) 2026 LingByte
// SPDX-License-Identifier: MIT

package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// timeoutResponseWriter wraps gin.ResponseWriter to make writes thread-safe
// and ignore writes from the handler goroutine after a timeout has fired.
// This prevents data races between the timeout response and the still-running
// handler's writes, since gin.ResponseWriter is not concurrency-safe.
type timeoutResponseWriter struct {
	gin.ResponseWriter
	mu       sync.Mutex
	timedOut bool
}

func (w *timeoutResponseWriter) Write(b []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.timedOut {
		return 0, nil
	}
	return w.ResponseWriter.Write(b)
}

func (w *timeoutResponseWriter) WriteString(s string) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.timedOut {
		return 0, nil
	}
	return w.ResponseWriter.WriteString(s)
}

func (w *timeoutResponseWriter) WriteHeader(code int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.timedOut {
		return
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *timeoutResponseWriter) WriteHeaderNow() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.timedOut {
		return
	}
	w.ResponseWriter.WriteHeaderNow()
}

func (w *timeoutResponseWriter) Written() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.ResponseWriter.Written()
}

func (w *timeoutResponseWriter) Status() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.ResponseWriter.Status()
}

func (w *timeoutResponseWriter) Size() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.ResponseWriter.Size()
}

// writeTimeoutResponse writes the given status + JSON body directly to the
// underlying writer, bypassing the timedOut check. Must be called with mu held.
func (w *timeoutResponseWriter) writeTimeoutResponse(status int, body map[string]interface{}) {
	w.timedOut = true
	w.ResponseWriter.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.ResponseWriter.WriteHeader(status)
	data, _ := json.Marshal(body)
	w.ResponseWriter.Write(data)
}

// TimeoutConfig 超时配置
type TimeoutConfig struct {
	// 默认超时时间
	DefaultTimeout time.Duration
	// 接口级别超时配置
	EndpointTimeouts map[string]time.Duration
	// 超时后的降级响应
	FallbackResponse interface{}
}

// CircuitBreakerConfig 熔断器配置
type CircuitBreakerConfig struct {
	// 失败阈值
	FailureThreshold int
	// 成功阈值（半开状态下）
	SuccessThreshold int
	// 超时时间
	Timeout time.Duration
	// 熔断器打开后的等待时间
	OpenTimeout time.Duration
	// 最大并发请求数
	MaxConcurrentRequests int
}

// CircuitBreakerState 熔断器状态
type CircuitBreakerState int

const (
	StateClosed CircuitBreakerState = iota
	StateHalfOpen
	StateOpen
)

// CircuitBreaker 熔断器
type CircuitBreaker struct {
	config          CircuitBreakerConfig
	state           CircuitBreakerState
	failureCount    int
	successCount    int
	lastFailureTime time.Time
	nextAttemptTime time.Time
	concurrentCount int
	mu              sync.RWMutex
}

// NewCircuitBreaker 创建新的熔断器
func NewCircuitBreaker(config CircuitBreakerConfig) *CircuitBreaker {
	return &CircuitBreaker{
		config: config,
		state:  StateClosed,
	}
}

// DefaultCircuitBreakerConfig 默认熔断器配置
func DefaultCircuitBreakerConfig() CircuitBreakerConfig {
	return CircuitBreakerConfig{
		FailureThreshold:      5, // 5次失败后打开熔断器
		SuccessThreshold:      3, // 3次成功后关闭熔断器
		Timeout:               30 * time.Second,
		OpenTimeout:           60 * time.Second, // 熔断器打开后60秒尝试半开
		MaxConcurrentRequests: 100,
	}
}

// Allow 检查是否允许请求
func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	now := time.Now()

	switch cb.state {
	case StateClosed:
		// 检查并发数
		if cb.concurrentCount >= cb.config.MaxConcurrentRequests {
			return false
		}
		cb.concurrentCount++
		return true

	case StateOpen:
		// 检查是否可以尝试半开
		if now.After(cb.nextAttemptTime) {
			cb.state = StateHalfOpen
			cb.successCount = 0
			cb.concurrentCount++
			return true
		}
		return false

	case StateHalfOpen:
		// 半开状态下限制并发
		if cb.concurrentCount >= 1 {
			return false
		}
		cb.concurrentCount++
		return true

	default:
		return false
	}
}

// RecordSuccess 记录成功
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.concurrentCount--
	if cb.concurrentCount < 0 {
		cb.concurrentCount = 0
	}

	switch cb.state {
	case StateClosed:
		cb.failureCount = 0

	case StateHalfOpen:
		cb.successCount++
		if cb.successCount >= cb.config.SuccessThreshold {
			cb.state = StateClosed
			cb.failureCount = 0
		}
	}
}

// RecordFailure 记录失败
func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.concurrentCount--
	if cb.concurrentCount < 0 {
		cb.concurrentCount = 0
	}

	cb.failureCount++
	cb.lastFailureTime = time.Now()

	switch cb.state {
	case StateClosed:
		if cb.failureCount >= cb.config.FailureThreshold {
			cb.state = StateOpen
			cb.nextAttemptTime = time.Now().Add(cb.config.OpenTimeout)
		}

	case StateHalfOpen:
		cb.state = StateOpen
		cb.nextAttemptTime = time.Now().Add(cb.config.OpenTimeout)
	}
}

// GetState 获取熔断器状态
func (cb *CircuitBreaker) GetState() CircuitBreakerState {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}

// GetStats 获取熔断器统计信息
func (cb *CircuitBreaker) GetStats() map[string]interface{} {
	cb.mu.RLock()
	defer cb.mu.RUnlock()

	return map[string]interface{}{
		"state":            cb.state,
		"failure_count":    cb.failureCount,
		"success_count":    cb.successCount,
		"concurrent_count": cb.concurrentCount,
		"last_failure":     cb.lastFailureTime,
		"next_attempt":     cb.nextAttemptTime,
	}
}

// TimeoutCircuitManager 超时和熔断管理器
type TimeoutCircuitManager struct {
	timeoutConfig        TimeoutConfig
	circuitBreakerConfig CircuitBreakerConfig
	breakerFactory       BreakerFactory
	circuitBreakers      sync.Map // map[string]Breaker
	mu                   sync.RWMutex
	enableTimeout        bool
	enableCircuitBreaker bool
	longLivedPrefixes    []string // 额外的长连接路径前缀
}

// NewTimeoutCircuitManager 创建超时和熔断管理器
func NewTimeoutCircuitManager(timeoutConfig TimeoutConfig, cbConfig CircuitBreakerConfig) *TimeoutCircuitManager {
	return &TimeoutCircuitManager{
		timeoutConfig:        timeoutConfig,
		circuitBreakerConfig: cbConfig,
		enableTimeout:        true,
		enableCircuitBreaker: true,
	}
}

// SetBreakerFactory overrides the default breaker creation strategy.
// Pass DefaultBreakerFactory, SREBreakerFactory, or a custom factory.
// Must be called before the middleware is first invoked.
func (m *TimeoutCircuitManager) SetBreakerFactory(f BreakerFactory) {
	if f != nil {
		m.breakerFactory = f
	}
}

// getBreakerFactory returns the configured factory or a default that
// wraps the legacy CircuitBreaker for backward compatibility.
func (m *TimeoutCircuitManager) getBreakerFactory() BreakerFactory {
	if m.breakerFactory != nil {
		return m.breakerFactory
	}
	// Legacy default: use the inline state-machine breaker.
	cfg := m.circuitBreakerConfig
	return func(endpoint string) Breaker {
		return &legacyBreakerAdapter{cb: NewCircuitBreaker(cfg)}
	}
}

// legacyBreakerAdapter wraps the inline CircuitBreaker to satisfy Breaker.
type legacyBreakerAdapter struct{ cb *CircuitBreaker }

func (a *legacyBreakerAdapter) Allow() error {
	if a.cb.Allow() {
		return nil
	}
	return errCircuitOpen
}

func (a *legacyBreakerAdapter) MarkSuccess() { a.cb.RecordSuccess() }
func (a *legacyBreakerAdapter) MarkFailed()  { a.cb.RecordFailure() }

// errCircuitOpen is the sentinel returned by the legacy adapter.
var errCircuitOpen = errCircuitOpenSentinel{}

type errCircuitOpenSentinel struct{}

func (errCircuitOpenSentinel) Error() string { return "middleware: circuit breaker open" }

// InitTimeoutCircuitManager configures the global timeout/circuit manager from app config.
// Safe to call once at startup; subsequent calls are no-ops (sync.Once).
func InitTimeoutCircuitManager(timeoutCfg TimeoutConfig, cbCfg CircuitBreakerConfig, enableTimeout, enableCircuitBreaker bool) {
	timeoutCircuitOnce.Do(func() {
		globalTimeoutCircuitManager = NewTimeoutCircuitManager(timeoutCfg, cbCfg)
		globalTimeoutCircuitManager.enableTimeout = enableTimeout
		globalTimeoutCircuitManager.enableCircuitBreaker = enableCircuitBreaker
	})
}

// SetLongLivedPrefixes registers additional path prefixes that should skip
// timeout/circuit wrapping (e.g. WebSocket / SSE / streaming endpoints).
func (m *TimeoutCircuitManager) SetLongLivedPrefixes(prefixes []string) {
	m.mu.Lock()
	m.longLivedPrefixes = prefixes
	m.mu.Unlock()
}

// DefaultTimeoutConfig 默认超时配置（仅包含探针，应用可自行注入 EndpointTimeouts）
func DefaultTimeoutConfig() TimeoutConfig {
	return TimeoutConfig{
		DefaultTimeout: 30 * time.Second,
		EndpointTimeouts: map[string]time.Duration{
			// Probes: fail fast (also skipped by isProbeEndpoint below).
			"/readyz":  2 * time.Second,
			"/ready":   2 * time.Second,
			"/healthz": 2 * time.Second,
			"/livez":   2 * time.Second,
			"/health":  2 * time.Second,
		},
		FallbackResponse: map[string]interface{}{
			"error":   "service_unavailable",
			"message": "服务暂时不可用，请稍后重试",
			"code":    503,
		},
	}
}

// getCircuitBreaker 获取熔断器
func (tcm *TimeoutCircuitManager) getCircuitBreaker(endpoint string) Breaker {
	if cb, ok := tcm.circuitBreakers.Load(endpoint); ok {
		return cb.(Breaker)
	}

	cb := tcm.getBreakerFactory()(endpoint)
	tcm.circuitBreakers.Store(endpoint, cb)
	return cb
}

// getTimeout 获取接口超时时间
func (tcm *TimeoutCircuitManager) getTimeout(endpoint string) time.Duration {
	if timeout, exists := tcm.timeoutConfig.EndpointTimeouts[endpoint]; exists {
		return timeout
	}
	for prefix, timeout := range tcm.timeoutConfig.EndpointTimeouts {
		if strings.HasSuffix(prefix, "/") && strings.HasPrefix(endpoint, prefix) {
			return timeout
		}
	}
	return tcm.timeoutConfig.DefaultTimeout
}

// 全局超时熔断管理器
var globalTimeoutCircuitManager *TimeoutCircuitManager
var timeoutCircuitOnce sync.Once

// GetTimeoutCircuitManager 获取全局超时熔断管理器
func GetTimeoutCircuitManager() *TimeoutCircuitManager {
	timeoutCircuitOnce.Do(func() {
		globalTimeoutCircuitManager = NewTimeoutCircuitManager(
			DefaultTimeoutConfig(),
			DefaultCircuitBreakerConfig(),
		)
	})
	return globalTimeoutCircuitManager
}

// isProbeEndpoint skips the timeout/circuit goroutine wrapper for liveness /
// readiness probes. Under high QPS those wrappers spawn one goroutine per
// request with a 30s default budget and amplify DB stampede when /readyz pings.
func isProbeEndpoint(endpoint string) bool {
	switch endpoint {
	case "/healthz", "/livez", "/health", "/readyz", "/ready", "/metrics":
		return true
	default:
		return false
	}
}

// isLongLivedEndpoint detects WebSocket / SSE / streaming endpoints.
// Also checks app-registered prefixes via the manager.
func isLongLivedEndpoint(endpoint string) bool {
	if strings.Contains(endpoint, "/ws") || strings.HasSuffix(endpoint, "/ws") {
		return true
	}
	if strings.Contains(endpoint, "/incoming/stream") || strings.HasSuffix(endpoint, "/stream") {
		return true
	}
	mgr := globalTimeoutCircuitManager
	if mgr != nil {
		mgr.mu.RLock()
		prefixes := mgr.longLivedPrefixes
		mgr.mu.RUnlock()
		for _, p := range prefixes {
			if strings.HasPrefix(endpoint, p) {
				return true
			}
		}
	}
	return false
}

// TimeoutMiddleware 超时中间件
func TimeoutMiddleware() gin.HandlerFunc {
	manager := GetTimeoutCircuitManager()

	return func(c *gin.Context) {
		endpoint := c.Request.URL.Path
		if isLongLivedEndpoint(endpoint) || isProbeEndpoint(endpoint) {
			c.Next()
			return
		}
		timeout := manager.getTimeout(endpoint)

		// 创建带超时的上下文
		ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
		defer cancel()

		// 替换请求上下文
		c.Request = c.Request.WithContext(ctx)

		// 用线程安全的 wrapper 替换 c.Writer，防止超时后 handler goroutine
		// 的写操作与超时响应竞争（gin.ResponseWriter 非线程安全）。
		tw := &timeoutResponseWriter{ResponseWriter: c.Writer}
		c.Writer = tw

		// 使用通道来检测请求是否完成
		done := make(chan struct{})
		go func() {
			defer close(done)
			c.Next()
		}()

		select {
		case <-done:
			// 请求正常完成
			return
		case <-ctx.Done():
			// 请求超时
			logger.WarnCtx(c.Request.Context(), "Request timeout",
				zap.String("endpoint", endpoint),
				zap.Duration("timeout", timeout),
				zap.String("method", c.Request.Method))

			// 返回超时错误（线程安全地写入）
			tw.mu.Lock()
			if !tw.ResponseWriter.Written() {
				tw.writeTimeoutResponse(http.StatusRequestTimeout, map[string]interface{}{
					"error":   "request_timeout",
					"message": fmt.Sprintf("请求超时，超过 %v", timeout),
					"timeout": timeout.String(),
				})
			}
			tw.mu.Unlock()

			// 等待 goroutine 结束，避免 c.Next() 与 gin handleHTTPRequest
			// 的 c.Next() 循环竞争 c.index（gin.Context 非线程安全）。
			// handler 的后续写操作已被 tw.timedOut 屏蔽。
			<-done
			return
		}
	}
}

// CircuitBreakerMiddleware 熔断器中间件
func CircuitBreakerMiddleware() gin.HandlerFunc {
	manager := GetTimeoutCircuitManager()

	return func(c *gin.Context) {
		endpoint := c.Request.URL.Path
		cb := manager.getCircuitBreaker(endpoint)

		// 检查熔断器是否允许请求
		if err := cb.Allow(); err != nil {
			logger.WarnCtx(c.Request.Context(), "Circuit breaker blocked request",
				zap.String("endpoint", endpoint),
				zap.String("reason", err.Error()))

			// 返回服务不可用错误
			c.JSON(http.StatusServiceUnavailable, manager.timeoutConfig.FallbackResponse)
			c.Abort()
			return
		}

		// 记录请求开始时间
		startTime := time.Now()

		// 执行请求
		c.Next()

		// 根据响应状态记录成功或失败
		duration := time.Since(startTime)
		status := c.Writer.Status()

		if status >= 200 && status < 400 {
			// 成功响应
			cb.MarkSuccess()
			logger.DebugCtx(c.Request.Context(), "Circuit breaker recorded success",
				zap.String("endpoint", endpoint),
				zap.Int("status", status),
				zap.Duration("duration", duration))
		} else if status >= 500 {
			// 服务器错误，记录失败
			cb.MarkFailed()
			logger.WarnCtx(c.Request.Context(), "Circuit breaker recorded failure",
				zap.String("endpoint", endpoint),
				zap.Int("status", status),
				zap.Duration("duration", duration))
		}
		// 4xx错误不记录为熔断器失败，因为这通常是客户端错误
	}
}

// CombinedTimeoutCircuitMiddleware 组合超时和熔断中间件。
// Respects enableTimeout / enableCircuitBreaker set via InitTimeoutCircuitManager.
func CombinedTimeoutCircuitMiddleware() gin.HandlerFunc {
	manager := GetTimeoutCircuitManager()

	return func(c *gin.Context) {
		if !manager.enableTimeout && !manager.enableCircuitBreaker {
			c.Next()
			return
		}

		endpoint := c.Request.URL.Path

		// WebSocket / SSE 长连接、以及健康探针：跳过超时与熔断包装。
		if isLongLivedEndpoint(endpoint) || isProbeEndpoint(endpoint) {
			c.Next()
			return
		}

		var cb Breaker
		if manager.enableCircuitBreaker {
			cb = manager.getCircuitBreaker(endpoint)
			if err := cb.Allow(); err != nil {
				logger.WarnCtx(c.Request.Context(), "Circuit breaker blocked request",
					zap.String("endpoint", endpoint),
					zap.String("reason", err.Error()))

				c.JSON(http.StatusServiceUnavailable, manager.timeoutConfig.FallbackResponse)
				c.Abort()
				return
			}
		}

		if !manager.enableTimeout {
			c.Next()
			if cb != nil {
				status := c.Writer.Status()
				if status >= 200 && status < 400 {
					cb.MarkSuccess()
				} else if status >= 500 {
					cb.MarkFailed()
				}
			}
			return
		}

		timeout := manager.getTimeout(endpoint)
		ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
		defer cancel()

		c.Request = c.Request.WithContext(ctx)

		// 用线程安全的 wrapper 替换 c.Writer（同 TimeoutMiddleware）。
		tw := &timeoutResponseWriter{ResponseWriter: c.Writer}
		c.Writer = tw

		done := make(chan struct{})
		var requestPanic interface{}

		go func() {
			defer func() {
				if r := recover(); r != nil {
					requestPanic = r
				}
				close(done)
			}()
			c.Next()
		}()

		select {
		case <-done:
			status := c.Writer.Status()

			if requestPanic != nil {
				logger.ErrorCtx(c.Request.Context(), "Request panic",
					zap.String("endpoint", endpoint),
					zap.Any("panic", requestPanic),
					zap.ByteString("stack", debug.Stack()))
				if cb != nil {
					cb.MarkFailed()
				}
				tw.mu.Lock()
				if !tw.ResponseWriter.Written() {
					tw.writeTimeoutResponse(http.StatusInternalServerError, map[string]interface{}{
						"error":   "internal_server_error",
						"message": "服务器内部错误",
					})
				}
				tw.mu.Unlock()
				return
			}

			if cb != nil {
				if status >= 200 && status < 400 {
					cb.MarkSuccess()
				} else if status >= 500 {
					cb.MarkFailed()
				}
			}
		case <-ctx.Done():
			if cb != nil {
				cb.MarkFailed()
			}
			logger.WarnCtx(c.Request.Context(), "Request timeout",
				zap.String("endpoint", endpoint),
				zap.Duration("timeout", timeout))

			tw.mu.Lock()
			if !tw.ResponseWriter.Written() {
				tw.writeTimeoutResponse(http.StatusRequestTimeout, map[string]interface{}{
					"error":   "request_timeout",
					"message": fmt.Sprintf("请求超时，超过 %v", timeout),
					"timeout": timeout.String(),
				})
			}
			tw.mu.Unlock()

			// 等待 goroutine 结束，避免 c.index data race。
			<-done
		}
	}
}

// GetCircuitBreakerStats 获取所有熔断器统计信息
func GetCircuitBreakerStats() map[string]interface{} {
	manager := GetTimeoutCircuitManager()
	stats := make(map[string]interface{})

	manager.circuitBreakers.Range(func(key, value interface{}) bool {
		endpoint := key.(string)
		cb := value.(Breaker)
		if adapter, ok := cb.(*legacyBreakerAdapter); ok {
			stats[endpoint] = adapter.cb.GetStats()
		} else {
			stats[endpoint] = map[string]string{"type": "custom"}
		}
		return true
	})

	return stats
}
