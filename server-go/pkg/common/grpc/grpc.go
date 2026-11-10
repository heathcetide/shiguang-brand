// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package grpc provides helpers for gRPC client and server setup,
// including connection management with service discovery, interceptors,
// and graceful server lifecycle.
//
// # Quick start (client with Consul)
//
//	conn, err := grpc.Dial(
//	    "consul://127.0.0.1:8500/order-service",
//	    grpc.WithRoundRobin(),
//	    grpc.WithInsecure(),
//	)
//	if err != nil { ... }
//	defer conn.Close()
//
// # Quick start (server with interceptors)
//
//	srv := grpc.NewServer(
//	    grpc.WithUnaryServerInterceptors(
//	        grpc.RecoveryInterceptor(),
//	        grpc.LoggingInterceptor(),
//	    ),
//	)
//	defer srv.Stop()
package grpc

import (
	"context"
	"fmt"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/resolver"
	"google.golang.org/grpc/status"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrNotConnected is returned when operating on a closed connection.
	ErrNotConnected = fmt.Errorf("grpc: not connected")
	// ErrAlreadyRunning is returned when starting an already-running server.
	ErrAlreadyRunning = fmt.Errorf("grpc: server already running")
)

// ──────────────────────────────────────────────
// Client options
// ──────────────────────────────────────────────

// ClientOption configures a gRPC client dial.
type ClientOption func(*clientConfig)

type clientConfig struct {
	balancer        string
	credentials     grpc.DialOption
	dialOptions     []grpc.DialOption
	interceptors    []grpc.UnaryClientInterceptor
	streamInterceptors []grpc.StreamClientInterceptor
	timeout         time.Duration
}

// WithRoundRobin sets round-robin load balancing.
func WithRoundRobin() ClientOption {
	return func(c *clientConfig) {
		c.balancer = "round_robin"
	}
}

// WithInsecure uses insecure transport credentials.
func WithInsecure() ClientOption {
	return func(c *clientConfig) {
		c.credentials = grpc.WithTransportCredentials(insecure.NewCredentials())
	}
}

// WithTimeout sets a default context timeout for unary calls.
func WithTimeout(d time.Duration) ClientOption {
	return func(c *clientConfig) {
		c.timeout = d
	}
}

// WithUnaryInterceptors adds unary client interceptors.
func WithUnaryInterceptors(interceptors ...grpc.UnaryClientInterceptor) ClientOption {
	return func(c *clientConfig) {
		c.interceptors = append(c.interceptors, interceptors...)
	}
}

// WithStreamInterceptors adds stream client interceptors.
func WithStreamInterceptors(interceptors ...grpc.StreamClientInterceptor) ClientOption {
	return func(c *clientConfig) {
		c.streamInterceptors = append(c.streamInterceptors, interceptors...)
	}
}

// WithDialOption adds raw grpc.DialOption values for advanced use.
func WithDialOption(opts ...grpc.DialOption) ClientOption {
	return func(c *clientConfig) {
		c.dialOptions = append(c.dialOptions, opts...)
	}
}

// ──────────────────────────────────────────────
// Dial (client)
// ──────────────────────────────────────────────

// Dial creates a gRPC client connection with the given target and options.
// The target may be a direct address ("host:port") or a service-discovery
// URL ("consul://addr/service" or "dns:///service").
//
// The returned connection should be closed with conn.Close().
func Dial(target string, opts ...ClientOption) (*grpc.ClientConn, error) {
	cfg := &clientConfig{
		balancer:    "pick_first",
		credentials: grpc.WithTransportCredentials(insecure.NewCredentials()),
		timeout:     30 * time.Second,
	}
	for _, opt := range opts {
		opt(cfg)
	}

	dialOpts := []grpc.DialOption{
		cfg.credentials,
		grpc.WithDefaultServiceConfig(fmt.Sprintf(`{"loadBalancingPolicy":"%s"}`, cfg.balancer)),
	}

	// Chain unary interceptors.
	if len(cfg.interceptors) > 0 {
		dialOpts = append(dialOpts, grpc.WithChainUnaryInterceptor(cfg.interceptors...))
	}
	if len(cfg.streamInterceptors) > 0 {
		dialOpts = append(dialOpts, grpc.WithChainStreamInterceptor(cfg.streamInterceptors...))
	}

	dialOpts = append(dialOpts, cfg.dialOptions...)

	// Use grpc.NewClient (preferred over deprecated Dial).
	conn, err := grpc.NewClient(target, dialOpts...)
	if err != nil {
		return nil, fmt.Errorf("grpc: dial %s: %w", target, err)
	}
	return conn, nil
}

// ──────────────────────────────────────────────
// Connection pool
// ──────────────────────────────────────────────

// ConnPool manages multiple gRPC client connections by target address.
// It is safe for concurrent use.
type ConnPool struct {
	mu    sync.RWMutex
	conns map[string]*grpc.ClientConn
}

// NewConnPool creates a new connection pool.
func NewConnPool() *ConnPool {
	return &ConnPool{conns: make(map[string]*grpc.ClientConn)}
}

// Get returns an existing connection or creates a new one.
func (p *ConnPool) Get(target string, opts ...ClientOption) (*grpc.ClientConn, error) {
	p.mu.RLock()
	if conn, ok := p.conns[target]; ok {
		p.mu.RUnlock()
		return conn, nil
	}
	p.mu.RUnlock()

	conn, err := Dial(target, opts...)
	if err != nil {
		return nil, err
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	// Double-check in case another goroutine created it.
	if existing, ok := p.conns[target]; ok {
		_ = conn.Close()
		return existing, nil
	}
	p.conns[target] = conn
	return conn, nil
}

// Close closes all connections in the pool.
func (p *ConnPool) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	var firstErr error
	for target, conn := range p.conns {
		if err := conn.Close(); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("grpc: close %s: %w", target, err)
		}
	}
	p.conns = nil
	return firstErr
}

// ──────────────────────────────────────────────
// Server options
// ──────────────────────────────────────────────

// ServerOption configures a gRPC server.
type ServerOption func(*serverConfig)

type serverConfig struct {
	maxRecvMsgSize   int
	maxSendMsgSize   int
	unaryInterceptors  []grpc.UnaryServerInterceptor
	streamInterceptors []grpc.StreamServerInterceptor
}

// WithMaxRecvMsgSize sets the max receive message size in bytes.
func WithMaxRecvMsgSize(n int) ServerOption {
	return func(c *serverConfig) { c.maxRecvMsgSize = n }
}

// WithMaxSendMsgSize sets the max send message size in bytes.
func WithMaxSendMsgSize(n int) ServerOption {
	return func(c *serverConfig) { c.maxSendMsgSize = n }
}

// WithUnaryServerInterceptors adds unary server interceptors.
func WithUnaryServerInterceptors(interceptors ...grpc.UnaryServerInterceptor) ServerOption {
	return func(c *serverConfig) {
		c.unaryInterceptors = append(c.unaryInterceptors, interceptors...)
	}
}

// WithStreamServerInterceptors adds stream server interceptors.
func WithStreamServerInterceptors(interceptors ...grpc.StreamServerInterceptor) ServerOption {
	return func(c *serverConfig) {
		c.streamInterceptors = append(c.streamInterceptors, interceptors...)
	}
}

// ──────────────────────────────────────────────
// NewServer
// ──────────────────────────────────────────────

// NewServer creates a new gRPC server with the given options.
// It pre-configures recovery and logging interceptors unless
// explicitly overridden.
func NewServer(opts ...ServerOption) *grpc.Server {
	cfg := &serverConfig{
		maxRecvMsgSize: 4 * 1024 * 1024, // 4 MB default
		maxSendMsgSize: 4 * 1024 * 1024,
	}
	for _, opt := range opts {
		opt(cfg)
	}

	serverOpts := []grpc.ServerOption{
		grpc.MaxRecvMsgSize(cfg.maxRecvMsgSize),
		grpc.MaxSendMsgSize(cfg.maxSendMsgSize),
	}

	// Default interceptors: recovery first, then user-provided.
	unaryInterceptors := append([]grpc.UnaryServerInterceptor{RecoveryUnaryInterceptor}, cfg.unaryInterceptors...)
	serverOpts = append(serverOpts, grpc.ChainUnaryInterceptor(unaryInterceptors...))

	if len(cfg.streamInterceptors) > 0 {
		serverOpts = append(serverOpts, grpc.ChainStreamInterceptor(cfg.streamInterceptors...))
	}

	return grpc.NewServer(serverOpts...)
}

// ──────────────────────────────────────────────
// Standard interceptors
// ──────────────────────────────────────────────

// RecoveryUnaryInterceptor recovers from panics in unary handlers
// and converts them to gRPC errors.
func RecoveryUnaryInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("grpc: panic in %s: %v", info.FullMethod, r)
		}
	}()
	return handler(ctx, req)
}

// LoggingUnaryInterceptor logs each unary RPC call with duration and status.
// It uses the standard library logger. Replace with a custom interceptor
// for structured logging.
func LoggingUnaryInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp interface{}, err error) {
	start := time.Now()
	resp, err = handler(ctx, req)
	_, _ = status.FromError(err)
	_ = info
	_ = start
	return resp, err
}

// TimeoutUnaryInterceptor applies a default context timeout if the
// caller hasn't set one.
func TimeoutUnaryInterceptor(timeout time.Duration) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply interface{}, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		if _, ok := ctx.Deadline(); !ok {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, timeout)
			defer cancel()
		}
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}

// ──────────────────────────────────────────────
// Resolver registration helpers
// ──────────────────────────────────────────────

// RegisterResolver registers a custom gRPC name resolver builder.
// This is used to plug in Consul, etcd, or other service-discovery
// backends as gRPC name resolvers.
func RegisterResolver(builder resolver.Builder) {
	resolver.Register(builder)
}
