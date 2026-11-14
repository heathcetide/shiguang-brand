// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package consul

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/registry"
	"github.com/hashicorp/consul/api"
)

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

// Config holds the Consul client configuration.
type Config struct {
	// Address is the Consul agent address (e.g. "127.0.0.1:8500").
	Address string

	// Scheme is "http" or "https" (default "http").
	Scheme string

	// Token is the ACL token (optional).
	Token string

	// Datacenter is the Consul datacenter (optional).
	Datacenter string

	// DefaultHealthInterval is the default health-check interval
	// (default 10s).
	DefaultHealthInterval time.Duration

	// DefaultHealthTimeout is the default health-check timeout
	// (default 5s).
	DefaultHealthTimeout time.Duration

	// DeregisterCriticalAfter is the duration after which a critical
	// service is automatically deregistered (default 30s).
	DeregisterCriticalAfter time.Duration
}

// ──────────────────────────────────────────────
// Consul registry
// ──────────────────────────────────────────────

// Consul implements [registry.Registry] using HashiCorp Consul.
type Consul struct {
	client  *api.Client
	cfg     Config
	mu      sync.Mutex
	closed  bool
	regIDs  map[string]bool // tracked registered instance IDs
}

// New creates a new Consul-backed registry.
func New(cfg Config) (*Consul, error) {
	if cfg.Address == "" {
		return nil, fmt.Errorf("consul: address is required")
	}
	if cfg.DefaultHealthInterval <= 0 {
		cfg.DefaultHealthInterval = 10 * time.Second
	}
	if cfg.DefaultHealthTimeout <= 0 {
		cfg.DefaultHealthTimeout = 5 * time.Second
	}
	if cfg.DeregisterCriticalAfter <= 0 {
		cfg.DeregisterCriticalAfter = 30 * time.Second
	}

	consulCfg := api.DefaultConfig()
	consulCfg.Address = cfg.Address
	if cfg.Scheme != "" {
		consulCfg.Scheme = cfg.Scheme
	}
	if cfg.Token != "" {
		consulCfg.Token = cfg.Token
	}
	if cfg.Datacenter != "" {
		consulCfg.Datacenter = cfg.Datacenter
	}

	client, err := api.NewClient(consulCfg)
	if err != nil {
		return nil, fmt.Errorf("consul: create client: %w", err)
	}

	return &Consul{
		client: client,
		cfg:    cfg,
		regIDs: make(map[string]bool),
	}, nil
}

// Register registers a service instance with Consul.
func (c *Consul) Register(ctx context.Context, inst registry.Instance) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return registry.ErrClosed
	}

	if inst.ID == "" {
		inst.ID = inst.ServiceName + "-" + formatAddress(inst.Host, inst.Port)
	}

	registration := &api.AgentServiceRegistration{
		ID:      inst.ID,
		Name:    inst.ServiceName,
		Address: inst.Host,
		Port:    inst.Port,
		Tags:    inst.Tags,
		Meta:    inst.Meta,
	}

	// Build health check.
	check := &api.AgentServiceCheck{}
	if inst.HealthPath != "" {
		check.HTTP = fmt.Sprintf("http://%s%s", inst.Address(), inst.HealthPath)
	} else {
		check.TCP = inst.Address()
	}

	interval := inst.HealthInterval
	if interval <= 0 {
		interval = c.cfg.DefaultHealthInterval
	}
	timeout := inst.HealthTimeout
	if timeout <= 0 {
		timeout = c.cfg.DefaultHealthTimeout
	}
	check.Interval = interval.String()
	check.Timeout = timeout.String()
	check.DeregisterCriticalServiceAfter = c.cfg.DeregisterCriticalAfter.String()

	registration.Check = check

	if err := c.client.Agent().ServiceRegister(registration); err != nil {
		return fmt.Errorf("consul: register service %s: %w", inst.ID, err)
	}

	c.regIDs[inst.ID] = true
	return nil
}

// Deregister removes a service instance from Consul.
func (c *Consul) Deregister(ctx context.Context, instanceID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return registry.ErrClosed
	}

	if err := c.client.Agent().ServiceDeregister(instanceID); err != nil {
		return fmt.Errorf("consul: deregister service %s: %w", instanceID, err)
	}

	delete(c.regIDs, instanceID)
	return nil
}

// Discover returns all healthy instances for a service name.
func (c *Consul) Discover(ctx context.Context, serviceName string) ([]registry.Instance, error) {
	if c.closed {
		return nil, registry.ErrClosed
	}

	services, _, err := c.client.Health().Service(serviceName, "", true, &api.QueryOptions{})
	if err != nil {
		return nil, fmt.Errorf("consul: discover service %s: %w", serviceName, err)
	}

	if len(services) == 0 {
		return nil, registry.ErrNotFound
	}

	instances := make([]registry.Instance, 0, len(services))
	for _, svc := range services {
		inst := registry.Instance{
			ServiceName: serviceName,
			ID:          svc.Service.ID,
			Host:        svc.Service.Address,
			Port:        svc.Service.Port,
			Tags:        svc.Service.Tags,
			Meta:        svc.Service.Meta,
		}
		if inst.Host == "" {
			inst.Host = svc.Node.Address
		}
		instances = append(instances, inst)
	}
	return instances, nil
}

// Watch polls Consul for service changes and sends updates to the
// returned channel. The poll interval is 5 seconds.
func (c *Consul) Watch(ctx context.Context, serviceName string) (<-chan []registry.Instance, error) {
	if c.closed {
		return nil, registry.ErrClosed
	}

	ch := make(chan []registry.Instance, 8)
	var lastIndex uint64

	go func() {
		defer close(ch)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				services, meta, err := c.client.Health().Service(serviceName, "", true, &api.QueryOptions{
					WaitIndex: lastIndex,
				})
				if err != nil {
					continue
				}

				if meta.LastIndex <= lastIndex {
					continue // no change
				}
				lastIndex = meta.LastIndex

				instances := make([]registry.Instance, 0, len(services))
				for _, svc := range services {
					inst := registry.Instance{
						ServiceName: serviceName,
						ID:          svc.Service.ID,
						Host:        svc.Service.Address,
						Port:        svc.Service.Port,
						Tags:        svc.Service.Tags,
						Meta:        svc.Service.Meta,
					}
					if inst.Host == "" {
						inst.Host = svc.Node.Address
					}
					instances = append(instances, inst)
				}

				select {
				case ch <- instances:
				default:
				}
			}
		}
	}()

	return ch, nil
}

// Close deregisters all instances registered through this registry
// and releases resources.
func (c *Consul) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return nil
	}
	c.closed = true

	for id := range c.regIDs {
		_ = c.client.Agent().ServiceDeregister(id)
	}
	c.regIDs = nil
	return nil
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

func formatAddress(host string, port int) string {
	return net.JoinHostPort(host, strconv.Itoa(port))
}

// GetOutboundIP returns the preferred outbound IP address of this
// machine by dialing a (non-connected) UDP socket to a public address.
// This is useful for registering services with the local IP rather
// than 127.0.0.1.
func GetOutboundIP() (net.IP, error) {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return nil, fmt.Errorf("consul: get outbound IP: %w", err)
	}
	defer conn.Close()

	localAddr := conn.LocalAddr().(*net.UDPAddr)
	return localAddr.IP, nil
}
