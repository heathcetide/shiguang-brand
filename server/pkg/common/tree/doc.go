// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package tree provides a generic service-tree (hierarchical resource
// organization) library for [ling-base].
//
// A service tree organizes resources into a fixed three-level hierarchy
// modeled as group.project.app (g.p.a), the pattern popularized by
// large-scale DevOps platforms. Each leaf node (app) is the attachment
// point for concrete resources (hosts, databases, load balancers, …).
// The tree itself is storage-agnostic: callers implement the [Store]
// interface, or use one of the provided backends:
//
//   - tree/memory    — in-process store for tests and single-node agents
//   - tree/gormstore — generic GORM-backed store (MySQL / PostgreSQL / SQLite)
//   - tree/mysql     — thin wrapper over gormstore with the MySQL driver
//   - tree/postgres  — thin wrapper over gormstore with the PostgreSQL driver
//   - tree/sqlite    — thin wrapper over gormstore with the SQLite driver
//
// # Storage model
//
// Nodes use a materialized-path scheme:
//
//	Level 1 (group)   path = "0"          e.g. inf
//	Level 2 (project) path = "/{gid}"     e.g. inf.monitor
//	Level 3 (app)     path = "/{gid}/{pid}" e.g. inf.monitor.prometheus
//
// This makes subtree queries a single prefix scan
// (path LIKE '/{gid}/%') and avoids recursive CTEs for the common case.
//
// # Quick start
//
//	store := memory.New()
//	tr := tree.New(store)
//
//	// Add a full g.p.a path; missing intermediate nodes are created
//	// automatically.
//	_, err := tr.Add(ctx, "inf.monitor.prometheus")
//
//	// Query all projects under a group
//	projects, _ := tr.Query(ctx, "inf", tree.QueryChildren)
//
//	// Query all apps under a group (recursive)
//	apps, _ := tr.Query(ctx, "inf", tree.QueryLeaves)
//
//	// Check existence of a full path
//	ok, _ := tr.Exists(ctx, "inf.monitor.prometheus")
//
//	// Delete with cascade
//	n, _ := tr.Delete(ctx, "inf", true)
//
// # Concurrency
//
// The [Tree] type is safe for concurrent use as long as the underlying
// [Store] is. The memory store is goroutine-safe; SQL stores rely on
// the database transactional guarantees exposed via [Store.Tx].
package tree
