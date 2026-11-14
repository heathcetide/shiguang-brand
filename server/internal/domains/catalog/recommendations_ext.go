// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

const (
	recipeScoringVersion   = "recipe-scoring-v5"
	recipeCandidateVersion = "recipe-candidate-v2"
)

func (h *Handlers) RecommendationVersions(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"scoringVersion":   recipeScoringVersion,
		"candidateVersion": recipeCandidateVersion,
	})
}

func (h *Handlers) RecommendationGetPreferences(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	state := h.loadUserJSONPref(userID)
	if _, ok := state["observations"]; !ok {
		state["observations"] = h.loadRecentRecommendationEvents(userID, 20)
	}
	c.JSON(http.StatusOK, state)
}

func (h *Handlers) RecommendationPatchPreferences(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	current := h.loadUserJSONPref(userID)
	if want, has := numBodyInt(body, "version"); has {
		cur, _ := numBodyInt(current, "version")
		if cur > 0 && want != cur {
			httpx.SendError(c, http.StatusConflict, "偏好已更新，请刷新后重试", "PREFERENCE_VERSION_CONFLICT")
			return
		}
	}
	for k, v := range body {
		current[k] = v
	}
	if h.hasTable("recommendation_learning_settings") {
		overrides, _ := json.Marshal(current)
		res, err := h.DB.Exec(`UPDATE recommendation_learning_settings SET overrides_json=?, version=version+1, updated_at=CURRENT_TIMESTAMP
			WHERE user_id=? AND (?=0 OR version=?)`,
			string(overrides), userID, wantVersion(body), wantVersion(body))
		if err == nil {
			if n, _ := res.RowsAffected(); n == 0 && wantVersion(body) > 0 {
				httpx.SendError(c, http.StatusConflict, "偏好已更新，请刷新后重试", "PREFERENCE_VERSION_CONFLICT")
				return
			}
		}
		_, _ = h.DB.Exec(`INSERT INTO recommendation_learning_settings (user_id, enabled, overrides_json, version)
			VALUES (?, 1, ?, 1)
			ON CONFLICT(user_id) DO UPDATE SET overrides_json=excluded.overrides_json, version=recommendation_learning_settings.version+1, updated_at=CURRENT_TIMESTAMP`,
			userID, string(overrides))
	}
	_ = h.upsertUserJSONPref(userID, current)
	state := h.loadUserJSONPref(userID)
	state["observations"] = h.loadRecentRecommendationEvents(userID, 20)
	c.JSON(http.StatusOK, state)
}

func wantVersion(body map[string]any) int {
	v, ok := numBodyInt(body, "version")
	if !ok {
		return 0
	}
	return v
}

func numBodyInt(body map[string]any, key string) (int, bool) {
	v, ok := body[key]
	if !ok {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return int(t), true
	case int:
		return t, true
	case string:
		n, err := strconv.Atoi(t)
		return n, err == nil
	default:
		return 0, false
	}
}

func (h *Handlers) RecommendationWeeklyPlan(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		body = map[string]any{}
	}
	start := asString(body["startDate"])
	if start == "" {
		start = time.Now().Format("2006-01-02")
	}
	inventory := h.loadUserInventoryNames(userID)
	prefs := kitchenConstraintsFromPrefs(h.loadUserJSONPref(userID))
	scored := h.scoreRecipesForUser(userID, inventory, h.loadRecipesForScoring(120, "", ""))
	picks := pickWeeklyRecipes(scored, 21, nil)
	gate := h.newRecKitchenwareGate(userID)
	mealTypes := []string{"breakfast", "lunch", "dinner"}
	days := make([]map[string]any, 0, 7)
	usedIngredients := make([]scoredRecipe, 0, 21)
	pickIdx := 0
	for i := 0; i < 7; i++ {
		day := timeMustParse(start).AddDate(0, 0, i).Format("2006-01-02")
		meals := make([]map[string]any, 0, 3)
		for _, mealType := range mealTypes {
			var recipe scoredRecipe
			if pickIdx < len(picks) {
				recipe = picks[pickIdx]
				pickIdx++
				usedIngredients = append(usedIngredients, recipe)
			}
			meals = append(meals, map[string]any{
				"id": fmt.Sprintf("%s-%s", day, mealType), "date": day, "mealType": mealType,
				"recipeId": recipe.ID, "title": recipe.Title, "servings": 1, "score": recipe.Score,
				"matchedIngredients": recipe.MatchedIngredients, "missingIngredients": recipe.MissingIngredients,
			})
		}
		days = append(days, map[string]any{"date": day, "meals": meals})
	}
	gaps := aggregateMissingGaps(usedIngredients)
	allocNames := make([]string, 0)
	for _, r := range usedIngredients {
		allocNames = append(allocNames, r.Matched...)
	}
	recipeIDs := make([]int, 0, len(usedIngredients))
	for _, r := range usedIngredients {
		if r.ID > 0 {
			recipeIDs = append(recipeIDs, r.ID)
		}
	}
	checks := h.enrichRecommendationChecks(userID, prefs, recipeIDs, gate, extendedCookingChecksPending())
	c.JSON(http.StatusOK, gin.H{
		"userId": userID, "startDate": start, "days": days, "gaps": gaps,
		"allocations":    h.inventoryAllocations(userID, allocNames),
		"checksPending":  checksPendingJSON(checks),
		"scoringVersion": recipeScoringVersion, "candidateVersion": recipeCandidateVersion,
	})
}

func (h *Handlers) RecommendationPlanRequirements(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	inventory := h.loadUserInventoryNames(userID)
	recipeIDs := collectRecipeIDs(body)
	if len(recipeIDs) == 0 {
		meals, _ := body["meals"].([]any)
		for _, raw := range meals {
			m, _ := raw.(map[string]any)
			if id, ok := numBodyInt(m, "recipeId"); ok && id > 0 {
				recipeIDs = append(recipeIDs, id)
			}
		}
	}
	requirements := make([]map[string]any, 0)
	covered := make([]map[string]any, 0)
	missing := make([]map[string]any, 0)
	for _, id := range recipeIDs {
		ingJSON, err := h.loadRecipeIngredientsByID(id)
		if err != nil {
			continue
		}
		lines := parseRecipeIngredientLines(ingJSON)
		for _, line := range lines {
			req := map[string]any{"recipeId": id, "foodName": line["name"], "amount": line["amount"]}
			requirements = append(requirements, req)
			found := false
			for _, stock := range inventory {
				if recNameMatches(line["name"], stock) {
					covered = append(covered, map[string]any{"foodName": line["name"], "inventoryName": stock})
					found = true
					break
				}
			}
			if !found {
				missing = append(missing, map[string]any{"foodName": line["name"], "amount": line["amount"]})
			}
		}
	}
	meals, _ := body["meals"].([]any)
	out := make([]map[string]any, 0, len(meals))
	for _, raw := range meals {
		m, _ := raw.(map[string]any)
		row := map[string]any{
			"id": asString(m["id"]), "date": asString(m["date"]), "mealType": asString(m["mealType"]),
			"allocations": h.inventoryAllocations(userID, h.ingredientNamesFromMeal(m)),
			"gaps":        missing,
		}
		if v := m["recipeId"]; v != nil {
			row["recipeId"] = v
		}
		if v := m["preparedServings"]; v != nil {
			row["preparedServings"] = v
		}
		if v := m["allocations"]; v != nil {
			row["allocations"] = v
		}
		out = append(out, row)
	}
	prefs := extractPrefsFromBody(body)
	if len(prefs) == 0 {
		prefs = kitchenConstraintsFromPrefs(h.loadUserJSONPref(userID))
	}
	gate := h.newRecKitchenwareGate(userID)
	allRecipeIDs := append([]int{}, recipeIDs...)
	for _, meal := range out {
		if id, ok := numBodyInt(meal, "recipeId"); ok {
			allRecipeIDs = append(allRecipeIDs, id)
		}
	}
	checks := h.enrichRecommendationChecks(userID, prefs, allRecipeIDs, gate, baseRecommendationChecksPending())
	handling := buildHandlingChecks(out)
	resp := gin.H{
		"meals": out, "requirements": requirements, "covered": covered, "missing": missing,
		"checksPending": checksPendingJSON(checks),
	}
	if len(handling) > 0 {
		resp["handlingChecks"] = handling
	}
	c.JSON(http.StatusOK, resp)
}

func collectRecipeIDs(body map[string]any) []int {
	ids := make([]int, 0)
	if raw, ok := body["recipeIds"].([]any); ok {
		for _, item := range raw {
			if id, ok := numBodyInt(map[string]any{"v": item}, "v"); ok {
				ids = append(ids, id)
			}
		}
	}
	return ids
}

func (h *Handlers) ingredientNamesFromMeal(meal map[string]any) []string {
	id, ok := numBodyInt(meal, "recipeId")
	if !ok || id <= 0 {
		id, ok = numBodyInt(meal, "recipe_id")
	}
	if !ok || id <= 0 {
		if raw, ok := meal["ingredients"].([]any); ok {
			names := make([]string, 0, len(raw))
			for _, item := range raw {
				switch v := item.(type) {
				case string:
					if s := strings.TrimSpace(v); s != "" {
						names = append(names, s)
					}
				case map[string]any:
					if s := strings.TrimSpace(asString(v["name"])); s != "" {
						names = append(names, s)
					}
				}
			}
			return names
		}
		return nil
	}
	var raw string
	if err := h.DB.QueryRow(`SELECT COALESCE(ingredients_json,'[]') FROM recipes WHERE id=?`, id).Scan(&raw); err != nil {
		return nil
	}
	lines := parseRecipeIngredientLines(raw)
	names := make([]string, 0, len(lines))
	for _, line := range lines {
		if n := strings.TrimSpace(line["name"]); n != "" {
			names = append(names, n)
		}
	}
	return names
}

func (h *Handlers) RecommendationCookingPlan(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	inventory := h.loadUserInventoryNames(userID)
	exclude := map[int]struct{}{}
	if raw, ok := body["excludeRecipeIds"].([]any); ok {
		for _, item := range raw {
			if id, ok := numBodyInt(map[string]any{"v": item}, "v"); ok {
				exclude[id] = struct{}{}
			}
		}
	}
	loaded := h.loadRecipesForScoring(100, "", "")
	scored := h.scoreRecipesForUser(userID, inventory, loaded)
	if len(scored) == 0 {
		// Still recommend recipes even when ingredients_json is empty / unparsable.
		for _, r := range loaded {
			if _, skip := exclude[r.ID]; skip {
				continue
			}
			scored = append(scored, r)
		}
	}
	reqMeals, _ := body["meals"].([]any)
	if len(reqMeals) == 0 {
		reqMeals = []any{map[string]any{"date": time.Now().UTC().Format("2006-01-02"), "mealType": "午餐"}}
	}
	meals := make([]map[string]any, 0, len(reqMeals))
	scoreIdx := 0
	for _, raw := range reqMeals {
		m, _ := raw.(map[string]any)
		if m == nil {
			m = map[string]any{}
		}
		var recipe scoredRecipe
		for scoreIdx < len(scored) {
			candidate := scored[scoreIdx]
			scoreIdx++
			if _, skip := exclude[candidate.ID]; skip {
				continue
			}
			recipe = candidate
			break
		}
		allocNames := recipe.Matched
		if len(allocNames) == 0 {
			allocNames = h.ingredientNamesFromMeal(map[string]any{"recipeId": recipe.ID})
		}
		allocations := h.inventoryAllocations(userID, allocNames)
		gaps := make([]map[string]any, 0, len(recipe.Missing))
		for _, name := range recipe.Missing {
			gaps = append(gaps, map[string]any{"foodName": name})
		}
		meals = append(meals, map[string]any{
			"id": asString(m["id"]), "date": asString(m["date"]), "mealType": asString(m["mealType"]),
			"recipeId": recipe.ID, "title": recipe.Title, "cookServings": 1, "score": recipe.Score,
			"allocations": allocations, "gaps": gaps,
			"matchedIngredients": recipe.MatchedIngredients, "missingIngredients": recipe.MissingIngredients,
		})
	}
	prefs := extractPrefsFromBody(body)
	if len(prefs) == 0 {
		prefs = kitchenConstraintsFromPrefs(h.loadUserJSONPref(userID))
	}
	gate := h.newRecKitchenwareGate(userID)
	checks := h.enrichRecommendationChecks(userID, prefs, recipeIDsFromMeals(meals), gate, extendedCookingChecksPending())
	handling := buildHandlingChecks(meals)
	resp := gin.H{
		"userId": userID, "meals": meals, "planningMode": asString(body["planningMode"]),
		"effectivePreferences": body["preferences"], "checksPending": checksPendingJSON(checks),
		"scoringVersion": recipeScoringVersion,
	}
	if len(handling) > 0 {
		resp["handlingChecks"] = handling
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handlers) RecommendationCookingPlanReplace(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	draft, _ := body["draft"].(map[string]any)
	targetMealID := asString(body["targetMealId"])
	recipeID, _ := numBodyInt(body, "recipeId")
	inventory := h.loadUserInventoryNames(userID)
	scored := h.scoreRecipesForUser(userID, inventory, h.loadRecipesForScoring(100, "", ""))
	var replacement scoredRecipe
	for _, r := range scored {
		if r.ID == recipeID {
			replacement = r
			break
		}
	}
	if replacement.ID == 0 {
		var title string
		_ = h.DB.QueryRow(`SELECT title FROM recipes WHERE id=?`, recipeID).Scan(&title)
		replacement = scoredRecipe{ID: recipeID, Title: title}
	}
	meals, _ := draft["meals"].([]any)
	updated := make([]map[string]any, 0, len(meals))
	replaced := false
	for _, raw := range meals {
		m, _ := raw.(map[string]any)
		if asString(m["id"]) == targetMealID {
			m["recipeId"] = replacement.ID
			m["title"] = replacement.Title
			m["score"] = replacement.Score
			m["allocations"] = h.inventoryAllocations(userID, replacement.Matched)
			m["gaps"] = missingToGaps(replacement.Missing)
			replaced = true
		}
		updated = append(updated, m)
	}
	if !replaced {
		httpx.SendError(c, http.StatusNotFound, "未找到目标餐次", "MEAL_NOT_FOUND")
		return
	}
	draft["meals"] = updated
	c.JSON(http.StatusOK, gin.H{"userId": userID, "draft": draft, "scoringVersion": recipeScoringVersion})
}

func missingToGaps(names []string) []map[string]any {
	out := make([]map[string]any, 0, len(names))
	for _, name := range names {
		out = append(out, map[string]any{"foodName": name})
	}
	return out
}

func (h *Handlers) RecommendationRecipes(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		body = map[string]any{}
	}
	c.JSON(http.StatusOK, h.recommendationPage(userID, body, 20))
}

func (h *Handlers) RecommendationEvents(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	idem := asString(body["idempotencyKey"])
	recipeID, _ := numBodyInt(body, "recipeId")
	eventType := asString(body["eventType"])
	if idem == "" || recipeID <= 0 || eventType == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	if h.hasTable("recipe_recommendation_events") {
		var existing string
		err := h.DB.QueryRow(`SELECT id FROM recipe_recommendation_events WHERE user_id=? AND idempotency_key=?`, userID, idem).Scan(&existing)
		if err == nil {
			c.JSON(http.StatusOK, gin.H{"eventId": existing, "repeated": true})
			return
		}
		eventID, _ := newUUID()
		meta, _ := json.Marshal(body["metadata"])
		_, err = h.DB.Exec(`INSERT INTO recipe_recommendation_events
			(id, user_id, recipe_id, event_type, scoring_version, surface, request_id, metadata_json, idempotency_key)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			eventID, userID, recipeID, eventType, asString(body["scoringVersion"]), asString(body["surface"]),
			asString(body["requestId"]), string(meta), idem)
		if err != nil {
			c.JSON(http.StatusCreated, gin.H{"eventId": idemHash(idem), "repeated": false})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"eventId": eventID, "repeated": false})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"eventId": idemHash(idem), "repeated": false})
}

func timeMustParse(iso string) time.Time {
	t, err := time.Parse("2006-01-02", iso)
	if err != nil {
		return time.Now()
	}
	return t
}

func idemHash(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:8])
}
