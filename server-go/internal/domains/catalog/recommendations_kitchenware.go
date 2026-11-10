// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
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

func (g *recKitchenwareGate) blockingForRecipe(recipeID int) []string {
	if recipeID <= 0 {
		return nil
	}
	if cached, ok := g.blockCache[recipeID]; ok {
		return cached
	}
	reqs := g.h.loadRecipeKitchenwareRequirements(recipeID)
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
	g.blockCache[recipeID] = blocking
	return blocking
}

func (g *recKitchenwareGate) hardConflict(recipeID int) bool {
	return len(g.blockingForRecipe(recipeID)) > 0
}
