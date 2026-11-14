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
	"time"
)

var recIngredientAliases = map[string]string{
	"西红柿": "番茄", "圣女果": "番茄", "小番茄": "番茄",
	"青花菜": "西兰花", "马铃薯": "土豆", "番薯": "红薯", "地瓜": "红薯",
}

type scoredRecipe struct {
	ID                 int
	Title              string
	Summary            string
	CookTime           int
	Difficulty         string
	IngredientsJSON    string
	ServingSize        float64
	Calories           float64
	Protein            float64
	Carbs              float64
	Fat                float64
	HasCalories        bool
	ImageURL           string
	Category           string
	Score              float64
	NutritionFit       float64
	Matched            []string
	Missing            []string
	MatchedIngredients []map[string]any
	MissingIngredients []map[string]any
}

type nutritionScoreContext struct {
	TargetCalories float64
	TodayCalories  float64
	Remaining      float64
	HasTarget      bool
	TargetProtein  float64
	TodayProtein   float64
	RemainingProtein float64
	HasProteinTarget bool
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
	calCol := "NULL"
	proCol := "NULL"
	carbCol := "NULL"
	fatCol := "NULL"
	if h.hasColumn("recipes", "calories") {
		calCol = "r.calories"
	}
	if h.hasColumn("recipes", "protein") {
		proCol = "r.protein"
	}
	if h.hasColumn("recipes", "carbs") {
		carbCol = "r.carbs"
	}
	if h.hasColumn("recipes", "fat") {
		fatCol = "r.fat"
	}
	imageCol := "''"
	switch {
	case h.hasColumn("recipes", "cover_image_url") && h.hasColumn("recipes", "image_url"):
		imageCol = "COALESCE(NULLIF(r.cover_image_url,''), NULLIF(r.image_url,''), '')"
	case h.hasColumn("recipes", "cover_image_url"):
		imageCol = "COALESCE(r.cover_image_url,'')"
	case h.hasColumn("recipes", "image_url"):
		imageCol = "COALESCE(r.image_url,'')"
	}
	catCol := "''"
	if h.hasColumn("recipes", "category") {
		catCol = "COALESCE(r.category,'')"
	}
	q := fmt.Sprintf(`SELECT r.id, r.title, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
		FROM recipes r WHERE %s ORDER BY r.id DESC LIMIT ?`,
		summaryCol, cookCol, diffCol, ingCol, servingCol, calCol, proCol, carbCol, fatCol, imageCol, catCol, where)
	args = append(args, limit*3)
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	recipes := make([]scoredRecipe, 0, limit*3)
	for rows.Next() {
		var r scoredRecipe
		var cal, pro, carb, fat sql.NullFloat64
		if rows.Scan(&r.ID, &r.Title, &r.Summary, &r.CookTime, &r.Difficulty, &r.IngredientsJSON, &r.ServingSize,
			&cal, &pro, &carb, &fat, &r.ImageURL, &r.Category) == nil {
			if cal.Valid {
				r.Calories = cal.Float64
				r.HasCalories = true
			}
			if pro.Valid {
				r.Protein = pro.Float64
			}
			if carb.Valid {
				r.Carbs = carb.Float64
			}
			if fat.Valid {
				r.Fat = fat.Float64
			}
			recipes = append(recipes, r)
		}
	}
	return recipes
}

func scoreRecipes(inventory []string, recipes []scoredRecipe, skip func(recipeID int) bool, nutrition nutritionScoreContext) []scoredRecipe {
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
		nutritionFit := 0.5
		nutritionBonus := 0.0
		if nutrition.HasTarget && recipe.HasCalories && recipe.Calories > 0 {
			remaining := nutrition.Remaining
			if remaining < 0 {
				remaining = 0
			}
			delta := recipe.Calories - remaining
			if delta <= 50 && recipe.Calories <= remaining+80 {
				nutritionFit = 1.0
				nutritionBonus = 12
			} else if delta <= 200 {
				nutritionFit = 0.7
				nutritionBonus = 4
			} else {
				nutritionFit = math.Max(0, 1-math.Min(1, math.Abs(delta)/600))
				nutritionBonus = -10 * (1 - nutritionFit)
			}
		} else if recipe.HasCalories {
			nutritionFit = 0.6
		}
		if nutrition.HasProteinTarget && recipe.Protein > 0 {
			remainingP := nutrition.RemainingProtein
			if remainingP < 0 {
				remainingP = 0
			}
			if recipe.Protein <= remainingP+15 {
				nutritionBonus += 6
				if nutritionFit < 0.85 {
					nutritionFit = math.Min(1, nutritionFit+0.15)
				}
			} else if recipe.Protein > remainingP+40 {
				nutritionBonus -= 4
			}
		}
		score := math.Round((coverage*35-math.Min(1, float64(len(missing))/float64(len(ings)))*20+timeFit*15+nutritionBonus)*100) / 100
		recipe.Score = score
		recipe.NutritionFit = math.Round(nutritionFit*100) / 100
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

func (h *Handlers) loadNutritionScoreContext(userID int) nutritionScoreContext {
	ctx := nutritionScoreContext{}
	if h.hasTable("user_health_profiles") {
		var payload sql.NullString
		_ = h.DB.QueryRow(`SELECT COALESCE(profile_json,'') FROM user_health_profiles WHERE user_id=?`, userID).Scan(&payload)
		if payload.Valid && strings.TrimSpace(payload.String) != "" {
			var profile map[string]any
			if json.Unmarshal([]byte(payload.String), &profile) == nil && profile != nil {
				if targets, ok := profile["nutrition_targets"].(map[string]any); ok {
					if v := asFloatPtr(targets["calories_kcal"]); v != nil && *v > 0 {
						ctx.TargetCalories = *v
						ctx.HasTarget = true
					}
					if v := asFloatPtr(targets["protein_g"]); v != nil && *v > 0 {
						ctx.TargetProtein = *v
						ctx.HasProteinTarget = true
					}
				}
				if !ctx.HasTarget {
					if calorieTarget, ok := profile["calorieTarget"].(map[string]any); ok {
						if v := asFloatPtr(calorieTarget["value"]); v != nil && *v > 0 {
							ctx.TargetCalories = *v
							ctx.HasTarget = true
						} else if v := asFloatPtr(calorieTarget["referenceValue"]); v != nil && *v > 0 {
							ctx.TargetCalories = *v
							ctx.HasTarget = true
						}
					}
				}
			}
		}
	}
	if !ctx.HasTarget {
		// Align with client useHealthSummary fallback so intake still steers ranking.
		ctx.TargetCalories = 2000
		ctx.HasTarget = true
	}
	todayCal, todayPro := h.todayDietMacros(userID)
	ctx.TodayCalories = todayCal
	ctx.TodayProtein = todayPro
	ctx.Remaining = ctx.TargetCalories - ctx.TodayCalories
	if ctx.HasProteinTarget {
		ctx.RemainingProtein = ctx.TargetProtein - ctx.TodayProtein
	}
	return ctx
}

func asFloatPtr(v any) *float64 {
	switch t := v.(type) {
	case nil:
		return nil
	case float64:
		return &t
	case float32:
		f := float64(t)
		return &f
	case int:
		f := float64(t)
		return &f
	case int64:
		f := float64(t)
		return &f
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return nil
		}
		return &f
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return nil
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil
		}
		return &f
	default:
		return nil
	}
}

func (h *Handlers) todayDietMacros(userID int) (calories float64, protein float64) {
	if !h.hasTable("diet_records") {
		return 0, 0
	}
	dateKey := time.Now().In(shanghaiLoc()).Format("2006-01-02")
	hasProtein := h.hasColumn("diet_records", "protein")
	query := `SELECT calories FROM diet_records WHERE user_id=? AND substr(COALESCE(recorded_at, created_at),1,10)=?`
	if hasProtein {
		query = `SELECT calories, protein FROM diet_records WHERE user_id=? AND substr(COALESCE(recorded_at, created_at),1,10)=?`
	}
	rows, err := h.DB.Query(query, userID, dateKey)
	if err != nil {
		return 0, 0
	}
	defer rows.Close()
	for rows.Next() {
		var cal, pro sql.NullFloat64
		var err error
		if hasProtein {
			err = rows.Scan(&cal, &pro)
		} else {
			err = rows.Scan(&cal)
		}
		if err != nil {
			continue
		}
		if cal.Valid {
			calories += cal.Float64
		}
		if pro.Valid {
			protein += pro.Float64
		}
	}
	return calories, protein
}

func shanghaiLoc() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.Local
	}
	return loc
}

func (h *Handlers) scoreRecipesForUser(userID int, inventory []string, recipes []scoredRecipe) []scoredRecipe {
	gate := h.newRecKitchenwareGate(userID)
	nutrition := h.loadNutritionScoreContext(userID)
	return scoreRecipes(inventory, recipes, func(recipeID int) bool {
		return gate.hardConflict(recipeID)
	}, nutrition)
}

// RecommendationPageForUser builds the client-facing recipe recommendation page.
func (h *Handlers) RecommendationPageForUser(userID int, body map[string]any, defaultLimit int) map[string]any {
	return h.recommendationPage(userID, body, defaultLimit)
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
		items = append(items, h.recommendationItemJSON(r))
	}
	var next any = nil
	if end < len(scored) {
		nextCursor, _ := json.Marshal(map[string]any{"v": 1, "offset": end})
		next = string(nextCursor)
	}
	return map[string]any{
		"requestId": fmt.Sprintf("go-%d", userID), "scoringVersion": recipeScoringVersion,
		"candidateVersion": recipeCandidateVersion, "dataUpdatedAt": nil,
		"items": items, "total": len(scored), "nextCursor": next,
	}
}

func (h *Handlers) recommendationItemJSON(r scoredRecipe) map[string]any {
	coverage := 0.0
	totalIng := len(r.Matched) + len(r.Missing)
	if totalIng > 0 {
		coverage = float64(len(r.Matched)) / float64(totalIng)
	}
	recipe := map[string]any{
		"id": r.ID, "title": r.Title, "description": r.Summary, "summary": r.Summary,
		"image_url": emptyNil(r.ImageURL), "cook_time": r.CookTime, "difficulty": r.Difficulty,
		"category": r.Category, "tags": []any{}, "steps": []any{}, "ingredients": r.MatchedIngredients,
		"quality_status": "trusted", "nutrition_basis": "source", "nutrition_is_estimated": !r.HasCalories,
	}
	if r.HasCalories {
		recipe["calories"] = r.Calories
	}
	if r.Protein > 0 || r.HasCalories {
		recipe["protein"] = r.Protein
	}
	if r.Carbs > 0 || r.HasCalories {
		recipe["carbs"] = r.Carbs
	}
	if r.Fat > 0 || r.HasCalories {
		recipe["fat"] = r.Fat
	}
	reasons := make([]string, 0, 3)
	if len(r.Matched) > 0 {
		reasons = append(reasons, fmt.Sprintf("库存可覆盖 %d 种食材", len(r.Matched)))
	}
	if r.NutritionFit >= 0.85 {
		reasons = append(reasons, "更贴近今日剩余热量")
	} else if r.HasCalories {
		reasons = append(reasons, "含营养参考")
	}
	return map[string]any{
		"recipeId": r.ID, "recipe": recipe, "score": r.Score,
		"scoringVersion": recipeScoringVersion, "candidateVersion": recipeCandidateVersion,
		"hardConstraints": map[string]any{"satisfied": []any{}, "unmet": []any{}},
		"features": map[string]any{
			"inventoryCoverage": math.Round(coverage*100) / 100,
			"matchedIngredients": r.MatchedIngredients, "expiringIngredients": []any{},
			"missingIngredients": r.MissingIngredients, "timeBudgetMinutes": nil,
			"estimatedTimeMinutes": r.CookTime, "nutritionFit": r.NutritionFit,
			"favorite": false, "recentRepeat": false, "skippedRecently": false,
		},
		"reasons": reasons, "dataUpdatedAt": nil, "degraded": []any{},
		"title": r.Title, "summary": r.Summary, "cook_time_minutes": r.CookTime,
		"matchedIngredients": r.MatchedIngredients, "missingIngredients": r.MissingIngredients,
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
