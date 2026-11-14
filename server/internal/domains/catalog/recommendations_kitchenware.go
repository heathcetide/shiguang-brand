// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"fmt"
	"strings"
)

type recKitchenwareGate struct {
	h            *Handlers
	ownedNames   []string
	capabilities map[string]struct{}
	blockCache   map[int][]string
}

func kitchenwareNameMatches(owned, required string) bool {
	a, b := strings.TrimSpace(owned), strings.TrimSpace(required)
	if a == "" || b == "" {
		return false
	}
	la, lb := strings.ToLower(a), strings.ToLower(b)
	return strings.Contains(la, lb) || strings.Contains(lb, la)
}

func (h *Handlers) newRecKitchenwareGate(userID int) *recKitchenwareGate {
	gate := &recKitchenwareGate{
		h:            h,
		ownedNames:   h.loadUserKitchenwareNames(userID),
		capabilities: h.loadUserKitchenwareCapabilities(userID),
		blockCache:   map[int][]string{},
	}
	return gate
}

func (h *Handlers) loadUserKitchenwareCapabilities(userID int) map[string]struct{} {
	out := map[string]struct{}{}
	if !h.hasTable("kitchenware_items") {
		return out
	}
	if h.hasTable("kitchenware_catalog_capabilities") {
		rows, err := h.DB.Query(`SELECT DISTINCT kcc.capability_code
			FROM kitchenware_items ki
			JOIN kitchenware_catalog_capabilities kcc ON kcc.catalog_id = ki.catalog_id
			WHERE ki.user_id=? AND COALESCE(ki.deleted_at,'')=''`, userID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var code string
				if rows.Scan(&code) == nil && strings.TrimSpace(code) != "" {
					out[strings.TrimSpace(code)] = struct{}{}
				}
			}
			return out
		}
	}
	return out
}

func (g *recKitchenwareGate) preload(recipeIDs []int) {
	if g == nil || len(recipeIDs) == 0 {
		return
	}
	pending := make([]int, 0, len(recipeIDs))
	seen := map[int]struct{}{}
	for _, id := range recipeIDs {
		if id <= 0 {
			continue
		}
		if _, ok := g.blockCache[id]; ok {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		pending = append(pending, id)
	}
	if len(pending) == 0 {
		return
	}
	reqsByRecipe := g.h.loadRecipeKitchenwareRequirementsBatch(pending)
	for _, id := range pending {
		g.blockCache[id] = g.blockingFromRequirements(reqsByRecipe[id])
	}
}

func (g *recKitchenwareGate) blockingFromRequirements(reqs []map[string]any) []string {
	blocking := make([]string, 0)
	for _, req := range reqs {
		role := asString(req["role"])
		if role != "" && role != "required" {
			continue
		}
		name := asString(req["name"])
		cap := asString(req["capability"])
		if cap == "" {
			cap = name
		}
		satisfied := false
		if name != "" {
			for _, own := range g.ownedNames {
				if kitchenwareNameMatches(own, name) {
					satisfied = true
					break
				}
			}
		}
		if !satisfied && cap != "" {
			if _, ok := g.capabilities[cap]; ok {
				satisfied = true
			}
			for _, own := range g.ownedNames {
				if kitchenwareNameMatches(own, cap) {
					satisfied = true
					break
				}
			}
		}
		if !satisfied {
			label := name
			if label == "" {
				label = cap
			}
			if label != "" {
				blocking = append(blocking, label)
			}
		}
	}
	return blocking
}

func (g *recKitchenwareGate) blockingForRecipe(recipeID int) []string {
	if recipeID <= 0 {
		return nil
	}
	if cached, ok := g.blockCache[recipeID]; ok {
		return cached
	}
	reqs := g.h.loadRecipeKitchenwareRequirements(recipeID)
	blocking := g.blockingFromRequirements(reqs)
	g.blockCache[recipeID] = blocking
	return blocking
}

func (g *recKitchenwareGate) hardConflict(recipeID int) bool {
	return len(g.blockingForRecipe(recipeID)) > 0
}

func (h *Handlers) loadRecipeKitchenwareRequirementsBatch(recipeIDs []int) map[int][]map[string]any {
	out := map[int][]map[string]any{}
	if len(recipeIDs) == 0 {
		return out
	}
	for _, id := range recipeIDs {
		out[id] = []map[string]any{}
	}
	if !h.hasTable("recipe_kitchenware_requirements") {
		return out
	}
	placeholders := make([]string, 0, len(recipeIDs))
	args := make([]any, 0, len(recipeIDs))
	for _, id := range recipeIDs {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	capCol := "''"
	if h.hasColumn("recipe_kitchenware_requirements", "capability_code") {
		capCol = "COALESCE(r.capability_code,'')"
	}
	q := fmt.Sprintf(`SELECT r.recipe_id, COALESCE(r.role,'required'), %s, COALESCE(c.capability_code,''), COALESCE(c.name,'')
		FROM recipe_kitchenware_requirements r
		LEFT JOIN kitchenware_catalog c ON c.id = r.catalog_id
		WHERE r.recipe_id IN (%s)`, capCol, strings.Join(placeholders, ","))
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var recipeID int
		var role, reqCap, catCap, name string
		if rows.Scan(&recipeID, &role, &reqCap, &catCap, &name) != nil {
			continue
		}
		cap := reqCap
		if cap == "" {
			cap = catCap
		}
		if name == "" {
			name = cap
		}
		out[recipeID] = append(out[recipeID], map[string]any{"role": role, "name": name, "capability": cap})
	}
	return out
}
