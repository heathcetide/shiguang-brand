// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

var recIngredientAliases = map[string]string{
	"西红柿": "番茄", "圣女果": "番茄", "小番茄": "番茄",
	"青花菜": "西兰花", "马铃薯": "土豆", "番薯": "红薯", "地瓜": "红薯",
}

type scoredRecipe struct {
	ID                int
	Title             string
	Summary           string
	CookTime          int
	Difficulty        string
	IngredientsJSON   string
	ServingSize       float64
	Score             float64
	Matched           []string
	Missing           []string
	MatchedIngredients []map[string]any
	MissingIngredients []map[string]any
}

func normalizeRecName(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	lower = regexp.MustCompile(`\([^)]*\)|（[^）]*）`).ReplaceAllString(lower, "")
	lower = regexp.MustCompile(`[\s·、，,。()（）/\\_-]`).ReplaceAllString(lower, "")
	for alias, canon := range recIngredientAliases {
		lower = strings.ReplaceAll(lower, strings.ToLower(alias), canon)
	}
	return lower
}

func recNameMatches(left, right string) bool {
	a, b := normalizeRecName(left), normalizeRecName(right)
	if a == "" || b == "" {
		return false
	}
	return strings.Contains(a, b) || strings.Contains(b, a)
}

func parseRecipeIngredientLines(raw string) []map[string]string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil
	}
	list, _ := parsed.([]any)
	out := make([]map[string]string, 0, len(list))
	for _, item := range list {
		switch v := item.(type) {
		case string:
			s := strings.TrimSpace(v)
			if s != "" {
				out = append(out, map[string]string{"name": s, "amount": ""})
			}
		case map[string]any:
			name := strings.TrimSpace(asString(v["name"]))
			if name == "" {
				continue
			}
			out = append(out, map[string]string{"name": name, "amount": strings.TrimSpace(asString(v["amount"]))})
		}
	}
	return out
}

func (h *Handlers) loadUserInventoryNames(userID int) []string {
	table := "inventory_items"
	if !h.hasTable(table) {
		return nil
	}
	rows, err := h.DB.Query(`SELECT food_name FROM inventory_items
		WHERE user_id=? AND deleted_at IS NULL AND COALESCE(is_available,1)=1`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	names := make([]string, 0)
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil && strings.TrimSpace(name) != "" {
			names = append(names, name)
		}
	}
	return names
}

func (h *Handlers) loadRecipesForScoring(limit int, search, category string) []scoredRecipe {
	if limit <= 0 {
		limit = 50
	}
	where := h.recipePublicWhere("r")
	args := []any{}
	if search != "" {
		where += ` AND (r.title LIKE ? OR r.summary LIKE ?)`
		q := "%" + search + "%"
		args = append(args, q, q)
	}
	if category != "" && h.hasColumn("recipes", "category") {
		where += ` AND r.category=?`
		args = append(args, category)
	}
	servingCol := "0"
	if h.hasColumn("recipes", "serving_size") {
		servingCol = "COALESCE(r.serving_size,0)"
	}
	ingCol := "''"
	if h.hasColumn("recipes", "ingredients_json") {
		ingCol = "COALESCE(r.ingredients_json,'[]')"
	}
	cookCol := "0"
	if h.hasColumn("recipes", "cook_time_minutes") {
		cookCol = "COALESCE(r.cook_time_minutes,0)"
	} else if h.hasColumn("recipes", "cook_time") {
		cookCol = "COALESCE(r.cook_time,0)"
	}
	summaryCol := "''"
	if h.hasColumn("recipes", "summary") {
		summaryCol = "COALESCE(r.summary,'')"
	} else if h.hasColumn("recipes", "description") {
		summaryCol = "COALESCE(r.description,'')"
	}
	diffCol := "''"
	if h.hasColumn("recipes", "difficulty") {
		diffCol = "COALESCE(r.difficulty,'')"
	}
	q := fmt.Sprintf(`SELECT r.id, r.title, %s, %s, %s, %s, %s
		FROM recipes r WHERE %s ORDER BY r.id DESC LIMIT ?`,
		summaryCol, cookCol, diffCol, ingCol, servingCol, where)
	args = append(args, limit*3)
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	recipes := make([]scoredRecipe, 0, limit*3)
	for rows.Next() {
		var r scoredRecipe
		if rows.Scan(&r.ID, &r.Title, &r.Summary, &r.CookTime, &r.Difficulty, &r.IngredientsJSON, &r.ServingSize) == nil {
			recipes = append(recipes, r)
		}
	}
	return recipes
}

func scoreRecipes(inventory []string, recipes []scoredRecipe, skip func(recipeID int) bool) []scoredRecipe {
	out := make([]scoredRecipe, 0, len(recipes))
	for _, recipe := range recipes {
		if skip != nil && skip(recipe.ID) {
			continue
		}
		ings := parseRecipeIngredientLines(recipe.IngredientsJSON)
		if len(ings) == 0 {
			continue
		}
		matched := make([]string, 0)
		missing := make([]string, 0)
		matchedObjs := make([]map[string]any, 0)
		missingObjs := make([]map[string]any, 0)
		for _, ing := range ings {
			found := false
			for _, stock := range inventory {
				if recNameMatches(ing["name"], stock) {
					found = true
					matched = append(matched, ing["name"])
					matchedObjs = append(matchedObjs, map[string]any{"name": ing["name"], "inventoryName": stock, "amount": ing["amount"]})
					break
				}
			}
			if !found {
				missing = append(missing, ing["name"])
				missingObjs = append(missingObjs, map[string]any{"name": ing["name"], "amount": ing["amount"]})
			}
		}
		coverage := float64(len(matched)) / float64(len(ings))
		timeFit := 1.0
		if recipe.CookTime > 0 {
			timeFit = math.Max(0, 1-float64(recipe.CookTime)/90.0)
		}
		score := math.Round((coverage*35-math.Min(1, float64(len(missing))/float64(len(ings)))*20+timeFit*15)*100) / 100
		recipe.Score = score
		recipe.Matched = matched
		recipe.Missing = missing
		recipe.MatchedIngredients = matchedObjs
		recipe.MissingIngredients = missingObjs
		out = append(out, recipe)
	}
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].Score > out[i].Score || (out[j].Score == out[i].Score && out[j].ID < out[i].ID) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	if len(out) > 0 {
		return out
	}
	return out
}

func (h *Handlers) scoreRecipesForUser(userID int, inventory []string, recipes []scoredRecipe) []scoredRecipe {
	gate := h.newRecKitchenwareGate(userID)
	return scoreRecipes(inventory, recipes, func(recipeID int) bool {
		return gate.hardConflict(recipeID)
	})
}

func (h *Handlers) recommendationPage(userID int, body map[string]any, defaultLimit int) map[string]any {
	pageSize := defaultLimit
	if v, err := strconv.Atoi(asString(body["pageSize"])); err == nil && v > 0 && v <= 100 {
		pageSize = v
	}
	offset := 0
	if body["cursor"] != nil {
		var cursor map[string]any
		raw := asString(body["cursor"])
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &cursor)
		} else if m, ok := body["cursor"].(map[string]any); ok {
			cursor = m
		}
		if off, ok := cursor["offset"].(float64); ok && off >= 0 {
			offset = int(off)
		}
	}
	search := asString(body["search"])
	category := asString(body["category"])
	inventory := h.loadUserInventoryNames(userID)
	scored := h.scoreRecipesForUser(userID, inventory, h.loadRecipesForScoring(200, search, category))
	end := offset + pageSize
	if end > len(scored) {
		end = len(scored)
	}
	items := make([]map[string]any, 0, end-offset)
	for _, r := range scored[offset:end] {
		items = append(items, map[string]any{
			"recipeId": r.ID, "title": r.Title, "summary": r.Summary,
			"score": r.Score, "cook_time_minutes": r.CookTime, "difficulty": r.Difficulty,
			"matchedIngredients": r.MatchedIngredients, "missingIngredients": r.MissingIngredients,
			"scoringVersion": recipeScoringVersion, "candidateVersion": recipeCandidateVersion,
		})
	}
	var next any = nil
	if end < len(scored) {
		nextCursor, _ := json.Marshal(map[string]any{"v": 1, "offset": end})
		next = string(nextCursor)
	}
	return map[string]any{
		"requestId": fmt.Sprintf("go-%d", userID), "scoringVersion": recipeScoringVersion,
		"candidateVersion": recipeCandidateVersion, "items": items, "total": len(scored), "nextCursor": next,
	}
}

func (h *Handlers) inventoryAllocations(userID int, ingredientNames []string) []map[string]any {
	if !h.hasTable("inventory_items") || len(ingredientNames) == 0 {
		return nil
	}
	rows, err := h.DB.Query(`SELECT id, food_name, quantity, COALESCE(version,1) FROM inventory_items
		WHERE user_id=? AND deleted_at IS NULL AND COALESCE(is_available,1)=1`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	type stock struct {
		id   int
		name string
		qty  string
		ver  int
	}
	stocks := make([]stock, 0)
	for rows.Next() {
		var s stock
		if rows.Scan(&s.id, &s.name, &s.qty, &s.ver) == nil {
			stocks = append(stocks, s)
		}
	}
	out := make([]map[string]any, 0, len(ingredientNames))
	for _, ing := range ingredientNames {
		for _, s := range stocks {
			if recNameMatches(ing, s.name) {
				out = append(out, map[string]any{
					"foodName": ing, "inventoryItemId": s.id, "inventoryName": s.name,
					"quantity": s.qty, "version": s.ver,
				})
				break
			}
		}
	}
	return out
}

func (h *Handlers) loadRecentRecommendationEvents(userID, limit int) []map[string]any {
	if limit <= 0 {
		limit = 20
	}
	if !h.hasTable("recipe_recommendation_events") {
		return []map[string]any{}
	}
	rows, err := h.DB.Query(`SELECT id, recipe_id, event_type, COALESCE(created_at,''), COALESCE(metadata_json,'')
		FROM recipe_recommendation_events WHERE user_id=? ORDER BY created_at DESC LIMIT ?`, userID, limit)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	out := make([]map[string]any, 0, limit)
	for rows.Next() {
		var id, recipeID int
		var eventType, created, meta string
		if rows.Scan(&id, &recipeID, &eventType, &created, &meta) == nil {
			out = append(out, map[string]any{
				"id": id, "recipeId": recipeID, "eventType": eventType, "createdAt": created, "metadata": meta,
			})
		}
	}
	return out
}

func aggregateMissingGaps(items []scoredRecipe) []map[string]any {
	counts := map[string]int{}
	for _, item := range items {
		for _, name := range item.Missing {
			counts[name]++
		}
	}
	out := make([]map[string]any, 0, len(counts))
	for name, count := range counts {
		out = append(out, map[string]any{"foodName": name, "occurrences": count})
	}
	return out
}

func pickWeeklyRecipes(scored []scoredRecipe, slots int, exclude map[int]struct{}) []scoredRecipe {
	if len(scored) == 0 {
		return nil
	}
	picked := make([]scoredRecipe, 0, slots)
	idx := 0
	lastID := 0
	for len(picked) < slots {
		r := scored[idx%len(scored)]
		idx++
		if exclude != nil {
			if _, skip := exclude[r.ID]; skip {
				if idx > len(scored)*4 {
					break
				}
				continue
			}
		}
		if r.ID == lastID && len(scored) > 1 {
			continue
		}
		picked = append(picked, r)
		lastID = r.ID
	}
	return picked
}

func (h *Handlers) loadRecipeIngredientsByID(id int) (string, error) {
	var raw sql.NullString
	err := h.DB.QueryRow(`SELECT COALESCE(ingredients_json,'[]') FROM recipes WHERE id=?`, id).Scan(&raw)
	if err != nil {
		return "", err
	}
	return raw.String, nil
}
