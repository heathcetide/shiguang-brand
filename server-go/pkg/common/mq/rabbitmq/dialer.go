// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package rabbitmq

import (
	"net"
	"time"
)

// dialer returns a dialer function for amqp.Config.Dial.
func dialer(timeout time.Duration) func(network, addr string) (net.Conn, error) {
	return func(network, addr string) (net.Conn, error) {
		return net.DialTimeout(network, addr, timeout)
	}
}
