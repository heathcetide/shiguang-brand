// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package tree

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Sentinel errors returned by the tree package.
var (
	// ErrEmptyPath is returned when an empty path string is provided.
	ErrEmptyPath = errors.New("tree: path must not be empty")

	// ErrInvalidPath is returned when a path does not match the
	// expected "g", "g.p" or "g.p.a" format.
	ErrInvalidPath = errors.New("tree: invalid path, expected g | g.p | g.p.a")

	// ErrNodeNotFound is returned when a node does not exist.
	ErrNodeNotFound = errors.New("tree: node not found")

	// ErrNodeExists is returned when attempting to add a duplicate node.
	ErrNodeExists = errors.New("tree: node already exists")

	// ErrHasChildren is returned when attempting to delete a node that
	// still has children and force=false.
	ErrHasChildren = errors.New("tree: node has children, use force delete")

	// ErrInvalidQueryType is returned when an unknown query type is passed.
	ErrInvalidQueryType = errors.New("tree: invalid query type")

	// ErrStoreNil is returned when New is called with a nil store.
	ErrStoreNil = errors.New("tree: store must not be nil")
)

// QueryType selects the result shape of [Tree.Query].
type QueryType int

const (
	// QueryChildren lists the direct children names of a group or project.
	//   path="g"     → ["p1", "p2", ...]
	//   path="g.p"   → ["a1", "a2", ...]
	QueryChildren QueryType = 1

	// QueryLeaves lists all leaf (app) paths under a group or project,
	// returned as fully-qualified "g.p.a" strings.
	//   path="g"     → ["g.p1.a1", "g.p1.a2", "g.p2.a3", ...]
	//   path="g.p"   → ["g.p.a1", "g.p.a2", ...]
	QueryLeaves QueryType = 2

	// QueryExists checks whether a full "g.p.a" path exists. The result
	// slice contains the path itself if it exists, otherwise it is empty.
	// Prefer [Tree.Exists] for a boolean check.
	QueryExists QueryType = 3
)

// Tree is the high-level service-tree API.
//
// All methods accept paths in dot-separated form: "g", "g.p", "g.p.a".
// [Tree.Add] auto-creates missing intermediate nodes; [Tree.Delete]
// optionally cascades to the entire subtree.
type Tree interface {
	// Add creates nodes for the given path. Missing intermediate nodes
	// are created automatically. If the full path already exists it
	// returns [ErrNodeExists]. Returns the leaf node (the last segment).
	Add(ctx context.Context, path string) (*Node, error)

	// Get returns the node at the given path, or [ErrNodeNotFound].
	Get(ctx context.Context, path string) (*Node, error)

	// Query returns path strings according to qt. See [QueryType].
	Query(ctx context.Context, path string, qt QueryType) ([]string, error)

	// Exists reports whether the given full "g.p.a" path exists.
	Exists(ctx context.Context, path string) (bool, error)

	// Delete removes the node at path. If force is false and the node
	// has children, it returns [ErrHasChildren]. If force is true, the
	// entire subtree is removed. Returns the number of deleted nodes.
	Delete(ctx context.Context, path string, force bool) (int64, error)

	// ListChildren returns the direct child nodes of the node at path.
	ListChildren(ctx context.Context, path string) ([]*Node, error)

	// SubTree returns all nodes in the subtree rooted at path (including
	// the node itself). For a group this returns all projects and apps
	// beneath it.
	SubTree(ctx context.Context, path string) ([]*Node, error)

	// Close releases resources held by the tree (and its store).
	Close() error
}

// treeImpl is the default [Tree] implementation. It is storage-agnostic
// and delegates persistence to the injected [Store].
type treeImpl struct {
	store Store
	now   func() time.Time
}

// New creates a [Tree] backed by the given [Store].
// Pass [WithClock] to inject a custom clock (useful for testing).
func New(store Store, opts ...Option) (Tree, error) {
	if store == nil {
		return nil, ErrStoreNil
	}
	o := applyOptions(opts...)
	return &treeImpl{store: store, now: o.now}, nil
}

// MustNew is like [New] but panics on error.
func MustNew(store Store, opts ...Option) Tree {
	tr, err := New(store, opts...)
	if err != nil {
		panic(err)
	}
	return tr
}

// ──────────────────────────────────────────────
// Path parsing helpers
// ──────────────────────────────────────────────

// parsePath splits a dot-separated path into its segments and returns
// the segment count. It validates the g.p.a format (1-3 segments).
func parsePath(path string) ([]string, error) {
	if path == "" {
		return nil, ErrEmptyPath
	}
	parts := strings.Split(path, ".")
	for _, p := range parts {
		if p == "" {
			return nil, ErrInvalidPath
		}
	}
	if len(parts) > 3 {
		return nil, ErrInvalidPath
	}
	return parts, nil
}

// fullPath joins segments into "g.p.a" form.
func fullPath(segments ...string) string {
	return strings.Join(segments, ".")
}

// ──────────────────────────────────────────────
// Add
// ──────────────────────────────────────────────

func (t *treeImpl) Add(ctx context.Context, path string) (*Node, error) {
	segments, err := parsePath(path)
	if err != nil {
		return nil, err
	}

	var leaf *Node
	err = t.store.Tx(ctx, func(ctx context.Context) error {
		// Walk down the path, creating missing nodes level by level.
		parentPath := RootPath
		for i, name := range segments {
			level := i + 1
			if level > 1 {
				// parentPath is updated at the end of each iteration
			}
			existing, gerr := t.store.Get(ctx, level, parentPath, name)
			if gerr != nil && !errors.Is(gerr, ErrNodeNotFound) {
				return gerr
			}
			if existing != nil {
				if i == len(segments)-1 {
					// The full leaf already exists.
					leaf = existing
					return ErrNodeExists
				}
				// Intermediate node exists; descend.
				parentPath = childPath(parentPath, existing.ID)
				leaf = existing
				continue
			}
			// Create the node.
			n := &Node{
				Level:     level,
				Path:      parentPath,
				Name:      name,
				CreatedAt: t.now(),
				UpdatedAt: t.now(),
			}
			if ierr := t.store.Insert(ctx, n); ierr != nil {
				return fmt.Errorf("tree: insert %s: %w", fullPath(segments[:i+1]...), ierr)
			}
			leaf = n
			parentPath = childPath(parentPath, n.ID)
		}
		return nil
	})
	if err != nil && !errors.Is(err, ErrNodeExists) {
		return nil, err
	}
	if errors.Is(err, ErrNodeExists) {
		// The full leaf path already exists. Return the existing node
		// along with ErrNodeExists so callers can distinguish "created"
		// from "already there".
		if leaf == nil {
			return nil, err
		}
		return leaf, err
	}
	return leaf, nil
}

// childPath returns the materialized path for a child of the node with
// the given parentPath and parentID.
//
//	childPath("0", 5)      → "/5"
//	childPath("/5", 12)    → "/5/12"
func childPath(parentPath string, parentID int64) string {
	if parentPath == RootPath {
		return fmt.Sprintf("/%d", parentID)
	}
	return fmt.Sprintf("%s/%d", parentPath, parentID)
}

// ──────────────────────────────────────────────
// Get
// ──────────────────────────────────────────────

func (t *treeImpl) Get(ctx context.Context, path string) (*Node, error) {
	segments, err := parsePath(path)
	if err != nil {
		return nil, err
	}
	return t.resolve(ctx, segments)
}

// resolve walks the path segments from the root and returns the leaf node.
func (t *treeImpl) resolve(ctx context.Context, segments []string) (*Node, error) {
	parentPath := RootPath
	var node *Node
	for i, name := range segments {
		level := i + 1
		n, err := t.store.Get(ctx, level, parentPath, name)
		if err != nil {
			return nil, err
		}
		if n == nil {
			return nil, fmt.Errorf("%w: %s", ErrNodeNotFound, fullPath(segments[:i+1]...))
		}
		node = n
		parentPath = childPath(parentPath, n.ID)
	}
	return node, nil
}

// ──────────────────────────────────────────────
// Query
// ──────────────────────────────────────────────

func (t *treeImpl) Query(ctx context.Context, path string, qt QueryType) ([]string, error) {
	segments, err := parsePath(path)
	if err != nil {
		return nil, err
	}
	switch qt {
	case QueryChildren:
		return t.queryChildren(ctx, segments)
	case QueryLeaves:
		return t.queryLeaves(ctx, segments)
	case QueryExists:
		return t.queryExists(ctx, segments)
	default:
		return nil, ErrInvalidQueryType
	}
}

func (t *treeImpl) queryChildren(ctx context.Context, segments []string) ([]string, error) {
	node, err := t.resolve(ctx, segments)
	if err != nil {
		return nil, err
	}
	if node.Level == LevelApp {
		// Apps have no children.
		return []string{}, nil
	}
	children, err := t.store.ListChildren(ctx, node.Level+1, childPathForNode(node))
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(children))
	for _, c := range children {
		names = append(names, c.Name)
	}
	return names, nil
}

// childPathForNode returns the path under which the node's children live.
func childPathForNode(n *Node) string {
	if n.Level == LevelGroup {
		// Group's path is "0"; its children's path is "/{gid}".
		return fmt.Sprintf("/%d", n.ID)
	}
	// Project's path is "/{gid}"; children's path is "/{gid}/{pid}".
	return fmt.Sprintf("%s/%d", n.Path, n.ID)
}

func (t *treeImpl) queryLeaves(ctx context.Context, segments []string) ([]string, error) {
	node, err := t.resolve(ctx, segments)
	if err != nil {
		return nil, err
	}
	switch node.Level {
	case LevelGroup:
		// All apps under this group: prefix = "/{gid}".
		prefix := fmt.Sprintf("/%d", node.ID)
		apps, err := t.store.ListByPathPrefix(ctx, LevelApp, prefix)
		if err != nil {
			return nil, err
		}
		// We need the group and project names to build full paths.
		// Fetch all projects under the group to map pid → name.
		projects, err := t.store.ListChildren(ctx, LevelProject, prefix)
		if err != nil {
			return nil, err
		}
		projectName := make(map[int64]string, len(projects))
		for _, p := range projects {
			projectName[p.ID] = p.Name
		}
		results := make([]string, 0, len(apps))
		for _, a := range apps {
			// a.Path = "/{gid}/{pid}"; extract pid.
			pid, ok := lastSegmentID(a.Path)
			if !ok {
				continue
			}
			pname := projectName[pid]
			results = append(results, fullPath(node.Name, pname, a.Name))
		}
		return results, nil

	case LevelProject:
		// All apps under this project: prefix = "/{gid}/{pid}".
		prefix := fmt.Sprintf("%s/%d", node.Path, node.ID)
		apps, err := t.store.ListByPathPrefix(ctx, LevelApp, prefix)
		if err != nil {
			return nil, err
		}
		// Look up the group name.
		gid, _ := lastSegmentID(node.Path)
		group, err := t.store.GetByID(ctx, gid)
		if err != nil {
			return nil, err
		}
		gname := ""
		if group != nil {
			gname = group.Name
		}
		results := make([]string, 0, len(apps))
		for _, a := range apps {
			results = append(results, fullPath(gname, node.Name, a.Name))
		}
		return results, nil

	case LevelApp:
		// A single leaf; return it as a full path.
		// Reconstruct from parent.
		pid, _ := lastSegmentID(node.Path)
		project, err := t.store.GetByID(ctx, pid)
		if err != nil {
			return nil, err
		}
		if project == nil {
			return nil, fmt.Errorf("%w: parent project of %s", ErrNodeNotFound, node.Name)
		}
		gid, _ := lastSegmentID(project.Path)
		group, err := t.store.GetByID(ctx, gid)
		if err != nil {
			return nil, err
		}
		gname := ""
		if group != nil {
			gname = group.Name
		}
		return []string{fullPath(gname, project.Name, node.Name)}, nil
	}
	return nil, ErrInvalidPath
}

func (t *treeImpl) queryExists(ctx context.Context, segments []string) ([]string, error) {
	if len(segments) != 3 {
		return nil, ErrInvalidPath
	}
	node, err := t.resolve(ctx, segments)
	if err != nil {
		if errors.Is(err, ErrNodeNotFound) {
			return []string{}, nil
		}
		return nil, err
	}
	_ = node
	return []string{fullPath(segments...)}, nil
}

// ──────────────────────────────────────────────
// Exists
// ──────────────────────────────────────────────

func (t *treeImpl) Exists(ctx context.Context, path string) (bool, error) {
	segments, err := parsePath(path)
	if err != nil {
		return false, err
	}
	if len(segments) != 3 {
		return false, ErrInvalidPath
	}
	_, err = t.resolve(ctx, segments)
	if err != nil {
		if errors.Is(err, ErrNodeNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// ──────────────────────────────────────────────
// Delete
// ──────────────────────────────────────────────

func (t *treeImpl) Delete(ctx context.Context, path string, force bool) (int64, error) {
	segments, err := parsePath(path)
	if err != nil {
		return 0, err
	}
	var deleted int64
	err = t.store.Tx(ctx, func(ctx context.Context) error {
		node, err := t.resolve(ctx, segments)
		if err != nil {
			return err
		}
		// Check for children unless force is set.
		if !force {
			childLevel := node.Level + 1
			if childLevel <= LevelApp {
				childPathStr := childPathForNode(node)
				children, cerr := t.store.ListChildren(ctx, childLevel, childPathStr)
				if cerr != nil {
					return cerr
				}
				if len(children) > 0 {
					return ErrHasChildren
				}
			}
		}
		// Cascade delete subtree.
		subtree, serr := t.collectSubtree(ctx, node)
		if serr != nil {
			return serr
		}
		// Delete deepest first to respect any FK constraints (best effort).
		for i := len(subtree) - 1; i >= 0; i-- {
			n := subtree[i]
			if derr := t.store.DeleteByID(ctx, n.ID); derr != nil {
				return derr
			}
			deleted++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return deleted, nil
}

// collectSubtree returns all nodes in the subtree rooted at node
// (including node itself), ordered shallow-first (root, then children,
// then grandchildren). Delete iterates this in reverse.
func (t *treeImpl) collectSubtree(ctx context.Context, root *Node) ([]*Node, error) {
	result := []*Node{root}
	// For groups and projects, fetch descendants via path prefix.
	if root.Level == LevelGroup {
		prefix := fmt.Sprintf("/%d", root.ID)
		descendants, err := t.store.ListByPathPrefix(ctx, 0, prefix)
		if err != nil {
			return nil, err
		}
		result = append(result, descendants...)
	} else if root.Level == LevelProject {
		prefix := fmt.Sprintf("%s/%d", root.Path, root.ID)
		descendants, err := t.store.ListByPathPrefix(ctx, 0, prefix)
		if err != nil {
			return nil, err
		}
		result = append(result, descendants...)
	}
	// Order by level ascending so reverse deletion goes deep-first.
	sortNodesByLevel(result)
	return result, nil
}

// ──────────────────────────────────────────────
// ListChildren / SubTree
// ──────────────────────────────────────────────

func (t *treeImpl) ListChildren(ctx context.Context, path string) ([]*Node, error) {
	segments, err := parsePath(path)
	if err != nil {
		return nil, err
	}
	node, err := t.resolve(ctx, segments)
	if err != nil {
		return nil, err
	}
	if node.Level == LevelApp {
		return []*Node{}, nil
	}
	return t.store.ListChildren(ctx, node.Level+1, childPathForNode(node))
}

func (t *treeImpl) SubTree(ctx context.Context, path string) ([]*Node, error) {
	segments, err := parsePath(path)
	if err != nil {
		return nil, err
	}
	node, err := t.resolve(ctx, segments)
	if err != nil {
		return nil, err
	}
	return t.collectSubtree(ctx, node)
}

// ──────────────────────────────────────────────
// Close
// ──────────────────────────────────────────────

func (t *treeImpl) Close() error {
	return t.store.Close()
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// lastSegmentID extracts the trailing numeric ID from a materialized
// path like "/5/12" → 12.
func lastSegmentID(path string) (int64, bool) {
	idx := strings.LastIndex(path, "/")
	if idx < 0 {
		return 0, false
	}
	var id int64
	_, err := fmt.Sscanf(path[idx+1:], "%d", &id)
	if err != nil {
		return 0, false
	}
	return id, true
}

// sortNodesByLevel sorts nodes ascending by Level (in-place, stable
// enough for the small subtree sizes we deal with).
func sortNodesByLevel(nodes []*Node) {
	// Simple insertion sort by level — subtree sizes are small.
	for i := 1; i < len(nodes); i++ {
		for j := i; j > 0 && nodes[j-1].Level > nodes[j].Level; j-- {
			nodes[j-1], nodes[j] = nodes[j], nodes[j-1]
		}
	}
}
