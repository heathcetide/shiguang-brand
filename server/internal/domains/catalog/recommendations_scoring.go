// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var recIngredientAliases = map[string]string{
	"西红柿": "番茄", "圣女果": "番茄", "小番茄": "番茄",
	"青花菜": "西兰花", "马铃薯": "土豆", "番薯": "红薯", "地瓜": "红薯",
}

// Expand profile allergy labels into ingredient tokens for soft/hard ranking filters.
var recAllergenAliases = map[string][]string{
	"坚果":  {"坚果", "花生", "核桃", "腰果", "杏仁", "榛子", "开心果", "松子"},
	"海鲜":  {"海鲜", "虾", "蟹", "贝", "蛤", "牡蛎", "鱿鱼", "章鱼", "鱼露"},
	"乳制品": {"牛奶", "奶油", "黄油", "芝士", "奶酪", "酸奶", "乳清", "炼乳", "乳制品"},
	"乳糖":  {"牛奶", "奶油", "酸奶", "乳糖", "炼乳", "乳清", "乳制品"},
	"麸质":  {"小麦", "面粉", "面包", "面条", "面筋", "麸质", "酱油", "生抽", "老抽", "大麦", "黑麦"},
	"鸡蛋":  {"鸡蛋", "蛋黄", "蛋白", "蛋液", "蛋清"},
	"大豆":  {"大豆", "黄豆", "豆浆", "豆腐", "豆皮", "腐竹", "酱油", "味噌"},
}

type allergenConstraint struct {
	Tokens   []string
	Severity string // mild | moderate | severe
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
	TargetCalories     float64
	TodayCalories      float64
	Remaining          float64
	HasTarget          bool
	TargetProtein      float64
	TodayProtein       float64
	RemainingProtein   float64
	HasProteinTarget   bool
	TargetCarbs        float64
	TodayCarbs         float64
	RemainingCarbs     float64
	HasCarbsTarget     bool
	TargetFat          float64
	TodayFat           float64
	RemainingFat       float64
	HasFatTarget       bool
	VegetarianStrict   bool
	VeganStrict        bool
}

var restrictionAllergenMap = map[string]string{
	"无麸质": "麸质",
	"麸质":  "麸质",
	"无乳制品": "乳制品",
	"乳制品": "乳制品",
	"无海鲜": "海鲜",
	"海鲜":  "海鲜",
	"无坚果": "坚果",
	"坚果":  "坚果",
	"无蛋":  "鸡蛋",
	"鸡蛋":  "鸡蛋",
	"无大豆": "大豆",
	"大豆":  "大豆",
}

var animalIngredientTokens = []string{
	"猪肉", "牛肉", "羊肉", "鸡肉", "鸭肉", "鹅肉", "火腿", "培根", "香肠", "排骨", "五花肉",
	"虾", "蟹", "鱼", "贝", "鱿鱼", "章鱼", "海鲜", "猪油", "鸡汤", "高汤",
}

var veganAnimalExtraTokens = []string{
	"鸡蛋", "蛋黄", "蛋白", "牛奶", "奶油", "黄油", "芝士", "奶酪", "酸奶", "蜂蜜", "乳清",
}

var veganIngredientTokens = append(append([]string{}, animalIngredientTokens...), veganAnimalExtraTokens...)

var (
	recParenStripRe = regexp.MustCompile(`\([^)]*\)|（[^）]*）`)
	recPunctStripRe = regexp.MustCompile(`[\s·、，,。()（）/\\_-]`)
)

func normalizeRecName(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	lower = recParenStripRe.ReplaceAllString(lower, "")
	lower = recPunctStripRe.ReplaceAllString(lower, "")
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
	fetchLimit := limit * 2
	if fetchLimit > 160 {
		fetchLimit = 160
	}
	if fetchLimit < limit {
		fetchLimit = limit
	}
	args = append(args, fetchLimit)
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	recipes := make([]scoredRecipe, 0, fetchLimit)
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

func recipeHitsAllergen(ings []map[string]string, tokens []string) bool {
	if len(ings) == 0 || len(tokens) == 0 {
		return false
	}
	for _, ing := range ings {
		name := ing["name"]
		for _, token := range tokens {
			if recNameMatches(name, token) {
				return true
			}
		}
	}
	return false
}

func scoreRecipes(inventory []string, recipes []scoredRecipe, skip func(recipeID int) bool, nutrition nutritionScoreContext, allergens []allergenConstraint) []scoredRecipe {
	out := make([]scoredRecipe, 0, len(recipes))
	for _, recipe := range recipes {
		if skip != nil && skip(recipe.ID) {
			continue
		}
		ings := parseRecipeIngredientLines(recipe.IngredientsJSON)
		if len(ings) == 0 {
			continue
		}
		allergyHitSeverity := ""
		for _, constraint := range allergens {
			if !recipeHitsAllergen(ings, constraint.Tokens) {
				continue
			}
			if constraint.Severity == "severe" {
				allergyHitSeverity = "severe"
				break
			}
			if allergyHitSeverity == "" || constraint.Severity == "moderate" {
				allergyHitSeverity = constraint.Severity
			}
		}
		if allergyHitSeverity == "severe" {
			continue
		}
		if nutrition.VeganStrict && recipeHitsAllergen(ings, veganIngredientTokens) {
			continue
		}
		if nutrition.VegetarianStrict && recipeHitsAllergen(ings, animalIngredientTokens) {
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
		if nutrition.HasCarbsTarget && recipe.Carbs > 0 {
			remainingC := nutrition.RemainingCarbs
			if remainingC < 0 {
				remainingC = 0
			}
			if recipe.Carbs <= remainingC+20 {
				nutritionBonus += 3
			} else if recipe.Carbs > remainingC+50 {
				nutritionBonus -= 3
			}
		}
		if nutrition.HasFatTarget && recipe.Fat > 0 {
			remainingF := nutrition.RemainingFat
			if remainingF < 0 {
				remainingF = 0
			}
			if recipe.Fat <= remainingF+12 {
				nutritionBonus += 2
			} else if recipe.Fat > remainingF+25 {
				nutritionBonus -= 3
			}
		}
		score := coverage*35 - math.Min(1, float64(len(missing))/float64(len(ings)))*20 + timeFit*15 + nutritionBonus
		if allergyHitSeverity == "moderate" {
			score -= 28
		} else if allergyHitSeverity == "mild" {
			score -= 14
		}
		recipe.Score = math.Round(score*100) / 100
		recipe.NutritionFit = math.Round(nutritionFit*100) / 100
		recipe.Matched = matched
		recipe.Missing = missing
		recipe.MatchedIngredients = matchedObjs
		recipe.MissingIngredients = missingObjs
		out = append(out, recipe)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].ID < out[j].ID
		}
		return out[i].Score > out[j].Score
	})
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
					if v := asFloatPtr(targets["carbs_g"]); v != nil && *v > 0 {
						ctx.TargetCarbs = *v
						ctx.HasCarbsTarget = true
					}
					if v := asFloatPtr(targets["fat_g"]); v != nil && *v > 0 {
						ctx.TargetFat = *v
						ctx.HasFatTarget = true
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
				if raw, ok := profile["dietary_restrictions"].([]any); ok {
					for _, item := range raw {
						label := strings.TrimSpace(asString(item))
						if label == "纯素" || strings.Contains(label, "纯素") {
							ctx.VeganStrict = true
							ctx.VegetarianStrict = true
						} else if label == "素食" || strings.Contains(label, "素食") {
							ctx.VegetarianStrict = true
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
	todayCal, todayPro, todayCarb, todayFat := h.todayDietMacros(userID)
	ctx.TodayCalories = todayCal
	ctx.TodayProtein = todayPro
	ctx.TodayCarbs = todayCarb
	ctx.TodayFat = todayFat
	ctx.Remaining = ctx.TargetCalories - ctx.TodayCalories
	if ctx.HasProteinTarget {
		ctx.RemainingProtein = ctx.TargetProtein - ctx.TodayProtein
	}
	if ctx.HasCarbsTarget {
		ctx.RemainingCarbs = ctx.TargetCarbs - ctx.TodayCarbs
	}
	if ctx.HasFatTarget {
		ctx.RemainingFat = ctx.TargetFat - ctx.TodayFat
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

func (h *Handlers) todayDietMacros(userID int) (calories, protein, carbs, fat float64) {
	if !h.hasTable("diet_records") {
		return 0, 0, 0, 0
	}
	dateKey := time.Now().In(shanghaiLoc()).Format("2006-01-02")
	hasProtein := h.hasColumn("diet_records", "protein")
	hasCarbs := h.hasColumn("diet_records", "carbs")
	hasFat := h.hasColumn("diet_records", "fat")
	selectSQL := `SELECT calories`
	if hasProtein {
		selectSQL += `, protein`
	}
	if hasCarbs {
		selectSQL += `, carbs`
	}
	if hasFat {
		selectSQL += `, fat`
	}
	selectSQL += ` FROM diet_records WHERE user_id=? AND substr(COALESCE(recorded_at, created_at),1,10)=?`
	rows, err := h.DB.Query(selectSQL, userID, dateKey)
	if err != nil {
		return 0, 0, 0, 0
	}
	defer rows.Close()
	for rows.Next() {
		var cal, pro, carb, fatVal sql.NullFloat64
		scan := []any{&cal}
		if hasProtein {
			scan = append(scan, &pro)
		}
		if hasCarbs {
			scan = append(scan, &carb)
		}
		if hasFat {
			scan = append(scan, &fatVal)
		}
		if rows.Scan(scan...) != nil {
			continue
		}
		if cal.Valid {
			calories += cal.Float64
		}
		if pro.Valid {
			protein += pro.Float64
		}
		if carb.Valid {
			carbs += carb.Float64
		}
		if fatVal.Valid {
			fat += fatVal.Float64
		}
	}
	return calories, protein, carbs, fat
}

func shanghaiLoc() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.Local
	}
	return loc
}

func (h *Handlers) loadUserAllergenConstraints(userID int) []allergenConstraint {
	if !h.hasTable("user_health_profiles") {
		return nil
	}
	var payload sql.NullString
	_ = h.DB.QueryRow(`SELECT COALESCE(profile_json,'') FROM user_health_profiles WHERE user_id=?`, userID).Scan(&payload)
	if !payload.Valid || strings.TrimSpace(payload.String) == "" {
		return nil
	}
	var profile map[string]any
	if json.Unmarshal([]byte(payload.String), &profile) != nil || profile == nil {
		return nil
	}
	seen := map[string]string{}
	appendConstraint := func(name, severity string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		if severity != "mild" && severity != "moderate" && severity != "severe" {
			severity = "moderate"
		}
		if prev, ok := seen[name]; ok {
			rank := map[string]int{"mild": 1, "moderate": 2, "severe": 3}
			if rank[severity] <= rank[prev] {
				return
			}
		}
		seen[name] = severity
	}
	if raw, ok := profile["allergies"].([]any); ok {
		for _, item := range raw {
			entry, ok := item.(map[string]any)
			if !ok {
				continue
			}
			appendConstraint(asString(entry["name"]), asString(entry["severity"]))
		}
	}
	if raw, ok := profile["dietary_restrictions"].([]any); ok {
		for _, item := range raw {
			label := strings.TrimSpace(asString(item))
			if label == "" || label == "素食" || label == "纯素" || strings.Contains(label, "素食") || strings.Contains(label, "纯素") {
				continue
			}
			mapped := restrictionAllergenMap[label]
			if mapped == "" {
				for key, value := range restrictionAllergenMap {
					if strings.Contains(label, key) {
						mapped = value
						break
					}
				}
			}
			if mapped == "" {
				// Treat free-text restriction as moderate demotion against that token.
				mapped = label
			}
			appendConstraint(mapped, "moderate")
		}
	}
	if len(seen) == 0 {
		return nil
	}
	out := make([]allergenConstraint, 0, len(seen))
	for name, severity := range seen {
		tokens := []string{name}
		if aliases, ok := recAllergenAliases[name]; ok {
			tokens = append(tokens, aliases...)
		}
		out = append(out, allergenConstraint{Tokens: tokens, Severity: severity})
	}
	return out
}

func (h *Handlers) scoreRecipesForUser(userID int, inventory []string, recipes []scoredRecipe) []scoredRecipe {
	gate := h.newRecKitchenwareGate(userID)
	ids := make([]int, 0, len(recipes))
	for _, recipe := range recipes {
		ids = append(ids, recipe.ID)
	}
	gate.preload(ids)
	nutrition := h.loadNutritionScoreContext(userID)
	allergens := h.loadUserAllergenConstraints(userID)
	return scoreRecipes(inventory, recipes, func(recipeID int) bool {
		return gate.hardConflict(recipeID)
	}, nutrition, allergens)
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
	scored := h.scoreRecipesForUser(userID, inventory, h.loadRecipesForScoring(80, search, category))
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
