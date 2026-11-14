// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package tree

import (
	"context"
	"time"
)

// Level constants for the three-tier service tree.
const (
	LevelGroup   = 1 // group (top-level organizational unit)
	LevelProject = 2 // project (a deliverable system within a group)
	LevelApp     = 3 // app (a deployable service within a project)
)

// RootPath is the materialized path of every level-1 (group) node.
const RootPath = "0"

// Node is a single entry in the service tree.
//
// Path uses a materialized-path scheme:
//
//	Level 1: "0"
//	Level 2: "/{GroupID}"
//	Level 3: "/{GroupID}/{ProjectID}"
//
// This allows subtree lookups via a simple path-prefix scan.
type Node struct {
	ID        int64     `json:"id"`
	Level     int       `json:"level"`
	Path      string    `json:"path"`   // materialized path, see package doc
	Name      string    `json:"name"`   // node name within its level
	Meta      string    `json:"meta"`   // optional opaque metadata (e.g. JSON blob)
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TableName returns the SQL table name for GORM-based stores. It is
// defined here so all backends share the same schema.
func (Node) TableName() string { return "service_tree_node" }

// Store is the persistence abstraction for the service tree.
//
// Implementations must be safe for concurrent use. SQL backends should
// honor the context for cancellation and timeouts.
//
// All lookup methods accept (level, path, name) which together uniquely
// identify a node within its parent. For level-1 nodes path is [RootPath]
// and the parent is implicit.
type Store interface {
	// Insert persists a new node. Implementations should set ID,
	// CreatedAt and UpdatedAt. The caller is responsible for ensuring
	// the parent exists and the (level, path, name) tuple is unique.
	Insert(ctx context.Context, n *Node) error

	// Get returns the node matching (level, path, name), or
	// [ErrNodeNotFound] if no such node exists.
	Get(ctx context.Context, level int, path, name string) (*Node, error)

	// GetByID returns the node with the given primary key, or
	// [ErrNodeNotFound] if it does not exist.
	GetByID(ctx context.Context, id int64) (*Node, error)

	// DeleteByID removes the node with the given primary key.
	// It does NOT cascade; the caller is responsible for subtree cleanup.
	DeleteByID(ctx context.Context, id int64) error

	// ListChildren returns the direct children of the node identified
	// by (level, path). For level-1 nodes path is [RootPath].
	// Returns an empty slice (not nil) if there are no children.
	ListChildren(ctx context.Context, level int, path string) ([]*Node, error)

	// ListByPathPrefix returns all nodes whose Path starts with prefix.
	// Used for recursive subtree lookups. level filters by node level;
	// pass 0 to match all levels. Returns an empty slice if none match.
	ListByPathPrefix(ctx context.Context, level int, pathPrefix string) ([]*Node, error)

	// Tx runs fn inside a transaction. If fn returns an error the
	// transaction is rolled back; otherwise it is committed.
	// Memory stores may implement this as a no-op (fn called directly).
	Tx(ctx context.Context, fn func(ctx context.Context) error) error

	// Close releases any resources held by the store.
	Close() error
}
