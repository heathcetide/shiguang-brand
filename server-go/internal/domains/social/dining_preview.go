// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"

	"database/sql"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

var diningAmountPattern = regexp.MustCompile(`(?i)^(\d+(?:\.\d+)?)\s*(kg|千克|公斤|ml|毫升|g|克|l|升|个|枚|只|份|袋|盒|瓶|罐)$`)

var diningUnitMap = map[string]string{
	"g": "g", "克": "g", "kg": "kg", "千克": "kg", "公斤": "kg",
	"ml": "ml", "毫升": "ml", "l": "l", "升": "l",
	"个": "piece", "枚": "piece", "只": "piece", "份": "serving",
	"袋": "bag", "盒": "box", "瓶": "bottle", "罐": "can",
}

var allergenAlias = map[string][]string{
	"坚果": {"坚果", "花生", "核桃", "杏仁", "腰果", "榛子", "开心果"},
	"花生": {"花生", "花生酱", "花生油"},
	"乳糖": {"牛奶", "乳糖", "奶油", "奶酪", "芝士", "酸奶", "炼乳"},
	"大豆": {"大豆", "黄豆", "豆浆", "豆腐", "豆皮", "酱油"},
	"海鲜": {"海鲜", "虾", "蟹", "贝", "鱼", "鱿鱼", "章鱼"},
	"麸质": {"小麦", "面粉", "面包", "面条", "麸质"},
	"鸡蛋": {"鸡蛋", "蛋液", "蛋黄", "蛋白"},
}

type diningMemberRow struct {
	membershipID int
	userID       int
	name         string
	version      int
	shared       bool
	allergies    []string
	restrictions []string
}

type ingredientLine struct {
	name   string
	amount string
}

type recipeDemand struct {
	foodName    string
	amountValue float64
	unit        string
}

func roundDining(v float64) float64 {
	return math.Round(v*1_000_000) / 1_000_000
}

func diningNameKey(name string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(name), " ", ""))
}

func allergyTerms(name string) []string {
	key := diningNameKey(name)
	terms := []string{key}
	for allergen, aliases := range allergenAlias {
		if strings.Contains(key, diningNameKey(allergen)) {
			terms = append(terms, aliases...)
		}
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(terms))
	for _, t := range terms {
		n := diningNameKey(t)
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		out = append(out, n)
	}
	return out
}

func parseRecipeIngredients(raw string) []ingredientLine {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil
	}
	list, _ := parsed.([]any)
	out := make([]ingredientLine, 0, len(list))
	for _, item := range list {
		switch v := item.(type) {
		case string:
			s := strings.TrimSpace(v)
			if s != "" {
				out = append(out, ingredientLine{name: s})
			}
		case map[string]any:
			name := strings.TrimSpace(asDiningString(v["name"]))
			if name == "" {
				continue
			}
			out = append(out, ingredientLine{name: name, amount: strings.TrimSpace(asDiningString(v["amount"]))})
		}
	}
	return out
}

func asDiningString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t))
		}
		return fmt.Sprintf("%g", t)
	default:
		return ""
	}
}

func recipeDemands(ingredients []ingredientLine, yieldSize, portions float64) []recipeDemand {
	if yieldSize <= 0 || portions <= 0 || len(ingredients) == 0 {
		return nil
	}
	out := make([]recipeDemand, 0, len(ingredients))
	for _, ing := range ingredients {
		if ing.amount == "" {
			return nil
		}
		m := diningAmountPattern.FindStringSubmatch(strings.TrimSpace(ing.amount))
		if m == nil {
			return nil
		}
		val, err := parseFloat(m[1])
		if err != nil || val <= 0 {
			return nil
		}
		unit := diningUnitMap[strings.ToLower(m[2])]
		if unit == "" {
			return nil
		}
		amount := roundDining(val * portions / yieldSize)
		out = append(out, recipeDemand{foodName: ing.name, amountValue: amount, unit: unit})
	}
	return out
}

func parseFloat(s string) (float64, error) {
	var v float64
	_, err := fmt.Sscan(s, &v)
	return v, err
}

func checkDiningRecipe(recipe map[string]any, participants []diningMemberRow, totalServings float64) map[string]any {
	ingredients := parseRecipeIngredients(asDiningString(recipe["ingredients_json"]))
	names := make([]string, 0, len(ingredients))
	measured := make([]ingredientLine, 0, len(ingredients))
	for _, ing := range ingredients {
		names = append(names, ing.name)
		if ing.amount != "" {
			measured = append(measured, ing)
		}
	}
	text := strings.ToLower(strings.ReplaceAll(strings.Join(append([]string{
		asDiningString(recipe["title"]), asDiningString(recipe["description"]),
	}, names...), "、"), " ", ""))
	conflicts := make([]map[string]any, 0)
	for _, p := range participants {
		for _, constraint := range p.allergies {
			for _, term := range allergyTerms(constraint) {
				if strings.Contains(text, term) {
					conflicts = append(conflicts, map[string]any{
						"membershipId": p.membershipID, "constraint": constraint, "kind": "allergy",
					})
					break
				}
			}
		}
		for _, constraint := range p.restrictions {
			normalized := diningNameKey(constraint)
			matched := strings.Contains(normalized, "素食") || strings.Contains(normalized, "纯素")
			if matched && regexp.MustCompile(`猪|牛|羊|鸡|鸭|鱼|虾|蟹|肉|蛋|奶`).MatchString(text) {
				conflicts = append(conflicts, map[string]any{"membershipId": p.membershipID, "constraint": constraint, "kind": "restriction"})
				continue
			}
			if strings.Contains(normalized, "清真") && regexp.MustCompile(`猪|料酒|酒精`).MatchString(text) {
				conflicts = append(conflicts, map[string]any{"membershipId": p.membershipID, "constraint": constraint, "kind": "restriction"})
			}
		}
	}
	yieldSize, _ := parseFloat(asDiningString(recipe["serving_size"]))
	if yieldSize == 0 {
		if y, ok := recipe["serving_size"].(float64); ok {
			yieldSize = y
		}
	}
	demands := recipeDemands(measured, yieldSize, totalServings)
	known := demands != nil && len(demands) > 0 && len(measured) == len(ingredients)
	materials := map[string]any{
		"status": "unknown", "recipeYield": nil, "demands": []any{},
	}
	if known {
		demandMaps := make([]any, 0, len(demands))
		for _, d := range demands {
			demandMaps = append(demandMaps, map[string]any{
				"food_name": d.foodName, "amount_value": d.amountValue, "unit": d.unit,
			})
		}
		materials = map[string]any{"status": "known", "recipeYield": yieldSize, "demands": demandMaps}
	} else if yieldSize > 0 {
		materials["recipeYield"] = yieldSize
	}
	rawIng, _ := json.Marshal(ingredients)
	fpPayload, _ := json.Marshal(map[string]any{
		"id": recipe["id"], "title": recipe["title"], "description": recipe["description"],
		"ingredients": json.RawMessage(rawIng), "servings": yieldSize,
	})
	sum := sha256.Sum256(fpPayload)
	status := "needs_review"
	if len(conflicts) > 0 {
		status = "blocked"
	}
	checks := []string{
		"逐人核对全部已共享限制、复合调料与实际制作条件；文本未匹配不代表符合忌口",
	}
	if !known {
		checks = append([]string{"原料总用量未能完整换算，请核对菜谱份数与每项配料数量"}, checks...)
	} else {
		checks = append([]string{"原料为共餐总需求，尚未扣除可用库存或已有预留"}, checks...)
	}
	if len(names) == 0 {
		checks = append(checks, "菜谱缺少可识别的配料，无法核对完整忌口")
	}
	recipeID := 0
	switch id := recipe["id"].(type) {
	case int:
		recipeID = id
	case float64:
		recipeID = int(id)
	}
	return map[string]any{
		"fingerprint": hexSHA(sum[:]),
		"recipeId":    recipeID,
		"title":       asDiningString(recipe["title"]),
		"status":      status,
		"materials":   materials,
		"conflicts":   conflicts,
		"checks":      checks,
	}
}

func hexSHA(b []byte) string {
	const hexdigits = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[i*2] = hexdigits[v>>4]
		out[i*2+1] = hexdigits[v&0x0f]
	}
	return string(out)
}

func (h *Handlers) loadDiningMemberRows(householdID, viewerUserID int) ([]diningMemberRow, error) {
	rows, err := h.DB.Query(`SELECT hm.id, hm.user_id, COALESCE(u.nickname,u.username) AS name,
		COALESCE(hm.dining_shared,0), COALESCE(hm.dining_version,1),
		CASE WHEN COALESCE(hm.dining_shared,0)=1 THEN hm.dining_preferences_json ELSE NULL END
		FROM household_members hm JOIN users u ON u.id=hm.user_id
		WHERE hm.household_id=? AND EXISTS (
			SELECT 1 FROM household_members viewer WHERE viewer.household_id=hm.household_id AND viewer.user_id=?)
		ORDER BY hm.id`, householdID, viewerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]diningMemberRow, 0)
	for rows.Next() {
		var r diningMemberRow
		var shared int
		var prefs sql.NullString
		if rows.Scan(&r.membershipID, &r.userID, &r.name, &shared, &r.version, &prefs) != nil {
			continue
		}
		r.shared = shared == 1
		if r.shared && prefs.Valid {
			var p map[string]any
			_ = json.Unmarshal([]byte(prefs.String), &p)
			r.allergies = stringList(p["allergies"])
			r.restrictions = stringList(p["restrictions"])
		}
		list = append(list, r)
	}
	return list, nil
}

func stringList(v any) []string {
	raw, _ := v.([]any)
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		s := strings.TrimSpace(asDiningString(item))
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

func (h *Handlers) diningRecipeRow(recipeID int) (map[string]any, bool) {
	where := `id=? AND deleted_at IS NULL`
	if h.hasColumn("recipes", "status") {
		where += ` AND status='approved'`
	}
	if h.hasColumn("recipes", "quality_status") {
		where += ` AND COALESCE(quality_status,'trusted')<>'needs_review'`
	}
	q := fmt.Sprintf(`SELECT id, title, COALESCE(description,''), COALESCE(ingredients_json,'[]'), COALESCE(serving_size,0)
		FROM recipes WHERE %s`, where)
	var id int
	var title, desc, ingredients string
	var serving float64
	if err := h.DB.QueryRow(q, recipeID).Scan(&id, &title, &desc, &ingredients, &serving); err != nil {
		return nil, false
	}
	return map[string]any{
		"id": id, "title": title, "description": desc, "ingredients_json": ingredients, "serving_size": serving,
	}, true
}

func (h *Handlers) hasColumn(table, column string) bool { return h.DB.HasColumn(table, column) }

func mealChangeDecision(status string, confirmed bool, purchaseChecked bool) string {
	switch status {
	case "completed", "cooking", "queued":
		return "keep"
	}
	if confirmed || purchaseChecked {
		return "suggest"
	}
	return "apply"
}

func (h *Handlers) diningPlanContext(userID int, planID, itemID string) (map[string]any, bool) {
	if !h.hasTable("meal_plan_items") {
		return nil, false
	}
	var (
		version                          int
		recipeID                         sql.NullInt64
		title, plannedDate, mealType, st string
		confirmed                        sql.NullString
	)
	err := h.DB.QueryRow(`SELECT i.version, i.recipe_id, COALESCE(i.recipe_title,i.title,''), i.planned_date, i.meal_type,
		COALESCE(i.status,'planned'), i.confirmed_at
		FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id
		WHERE i.id=? AND i.plan_id=? AND i.user_id=? AND p.user_id=?
			AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='active'`,
		itemID, planID, userID, userID).
		Scan(&version, &recipeID, &title, &plannedDate, &mealType, &st, &confirmed)
	if err != nil {
		return nil, false
	}
	purchaseChecked := false
	if h.hasTable("shopping_list_items") {
		var n int
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM shopping_list_items WHERE user_id=? AND client_id LIKE ? AND checked=1`,
			userID, "meal-plan:"+itemID+":%").Scan(&n)
		purchaseChecked = n > 0
	}
	var rid int
	if recipeID.Valid {
		rid = int(recipeID.Int64)
	}
	item := map[string]any{
		"version": version, "recipe_id": rid, "title": title,
		"planned_date": plannedDate, "meal_type": mealType, "status": st,
	}
	decision := mealChangeDecision(st, confirmed.Valid, purchaseChecked)
	return map[string]any{"item": item, "decision": decision}, true
}

func diningFoodNamesMatch(left, right string) bool {
	a := diningNameKey(left)
	b := diningNameKey(right)
	if a == "" || b == "" {
		return false
	}
	return strings.Contains(a, b) || strings.Contains(b, a)
}

func (h *Handlers) hasTable(name string) bool { return h.DB.HasTable(name) }

func (h *Handlers) householdInventoryCoverage(householdID int, demands []recipeDemand) (coverage []map[string]any, netShopping []map[string]any) {
	tbl := h.inventoryTable()
	rows, err := h.DB.Query(fmt.Sprintf(`SELECT id, food_name, quantity, COALESCE(version,1), COALESCE(is_available,1)
		FROM %s WHERE household_id=?`, tbl), householdID)
	if err != nil {
		return nil, nil
	}
	defer rows.Close()
	type stock struct {
		id      int
		name    string
		qty     string
		version int
		avail   bool
	}
	stocks := make([]stock, 0)
	for rows.Next() {
		var s stock
		var avail int
		if rows.Scan(&s.id, &s.name, &s.qty, &s.version, &avail) == nil {
			s.avail = avail != 0
			stocks = append(stocks, s)
		}
	}
	for _, demand := range demands {
		var covered float64
		var matchedItemID int
		for i := range stocks {
			if !stocks[i].avail || !diningFoodNamesMatch(stocks[i].name, demand.foodName) {
				continue
			}
			parsed := recipeDemands([]ingredientLine{{name: stocks[i].name, amount: strings.TrimSpace(stocks[i].qty)}}, 1, 1)
			if len(parsed) != 1 || parsed[0].unit != demand.unit {
				continue
			}
			use := math.Min(demand.amountValue-covered, parsed[0].amountValue)
			if use > 0 {
				covered = roundDining(covered + use)
				matchedItemID = stocks[i].id
			}
		}
		missing := roundDining(math.Max(0, demand.amountValue-covered))
		coverage = append(coverage, map[string]any{
			"food_name": demand.foodName, "required": demand.amountValue, "covered": covered,
			"unit": demand.unit, "inventoryItemId": matchedItemID,
		})
		if missing > 0 {
			netShopping = append(netShopping, map[string]any{
				"food_name": demand.foodName, "amount_value": missing, "unit": demand.unit,
			})
		}
	}
	return coverage, netShopping
}

func (h *Handlers) previewDiningAllocation(c *gin.Context, userID, householdID int, body map[string]any) {
	members, err := h.loadDiningMemberRows(householdID, userID)
	if err != nil || len(members) == 0 {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	rawParts, _ := body["participants"].([]any)
	if len(rawParts) == 0 {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	seen := map[int]struct{}{}
	participants := make([]map[string]any, 0, len(rawParts))
	totalMicro := 0
	for _, raw := range rawParts {
		m, ok := raw.(map[string]any)
		if !ok {
			httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
			return
		}
		memID, _ := numField(m, "membershipId", "membership_id")
		ver, _ := numField(m, "version")
		servings := 1.0
		if v, ok := m["servings"].(float64); ok && v > 0 {
			servings = v
		}
		if memID <= 0 {
			httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
			return
		}
		if _, dup := seen[memID]; dup {
			httpx.SendError(c, http.StatusBadRequest, "共餐成员不能重复", "INVALID_BODY")
			return
		}
		seen[memID] = struct{}{}
		var member *diningMemberRow
		for i := range members {
			if members[i].membershipID == memID {
				member = &members[i]
				break
			}
		}
		if member == nil || member.version != ver {
			httpx.SendError(c, http.StatusConflict, "共餐成员或忌口已变化，请重新读取后选择", "DINING_MEMBERS_CHANGED")
			return
		}
		if !member.shared {
			httpx.SendError(c, http.StatusConflict, "参与成员尚未授权共餐忌口，请先由本人确认并授权", "DINING_CONSENT_REQUIRED")
			return
		}
		totalMicro += int(math.Round(servings * 1_000_000))
		participants = append(participants, map[string]any{
			"membershipId": member.membershipID, "userId": member.userID, "name": member.name,
			"version": member.version, "shared": true,
			"allergies": toAnyList(member.allergies), "restrictions": toAnyList(member.restrictions),
			"servings": servings,
		})
	}
	totalServings := float64(totalMicro) / 1_000_000

	var recipeID *int
	if rid, ok := numField(body, "recipeId", "recipe_id"); ok && rid > 0 {
		recipeID = &rid
	}

	var planItemOut map[string]any
	supplyEligible := false
	if planRaw, ok := body["planItem"].(map[string]any); ok {
		planID := strField(planRaw, "planId", "plan_id")
		itemID := strField(planRaw, "itemId", "item_id")
		planVer, _ := numField(planRaw, "version")
		if planID == "" || itemID == "" || planVer <= 0 {
			httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
			return
		}
		ctx, found := h.diningPlanContext(userID, planID, itemID)
		if !found {
			httpx.SendError(c, http.StatusNotFound, "个人餐次不存在或不可用于共餐预览", "PLAN_ITEM_UNAVAILABLE")
			return
		}
		item := ctx["item"].(map[string]any)
		itemVer := 0
		switch v := item["version"].(type) {
		case int:
			itemVer = v
		case float64:
			itemVer = int(v)
		}
		if itemVer != planVer {
			httpx.SendError(c, http.StatusConflict, "个人餐次已变化，请刷新后重新预览", "PLAN_ITEM_CHANGED")
			return
		}
		supplyEligible = asDiningString(item["status"]) == "planned"
		if rid, ok := item["recipe_id"].(int); ok && rid > 0 {
			if recipeID != nil && *recipeID != rid {
				httpx.SendError(c, http.StatusConflict, "所选菜谱与当前餐次不一致，请刷新后重试", "PLAN_RECIPE_CHANGED")
				return
			}
			recipeID = &rid
		}
		planItemOut = map[string]any{
			"planId": planID, "itemId": itemID, "version": planVer,
			"plannedDate": item["planned_date"], "mealType": item["meal_type"],
			"title": item["title"], "decision": ctx["decision"], "applied": false,
		}
	}

	var recipeCheck map[string]any
	if recipeID != nil {
		recipe, ok := h.diningRecipeRow(*recipeID)
		if !ok {
			httpx.SendError(c, http.StatusNotFound, "菜谱不可用于共餐检查", "RECIPE_UNAVAILABLE")
			return
		}
		rows := make([]diningMemberRow, 0, len(participants))
		for _, p := range participants {
			mid, _ := numField(p, "membershipId")
			for _, m := range members {
				if m.membershipID == mid {
					rows = append(rows, m)
					break
				}
			}
		}
		recipeCheck = checkDiningRecipe(recipe, rows, totalServings)
	}

	allergySet := map[string]struct{}{}
	restrictionSet := map[string]struct{}{}
	for _, p := range participants {
		for _, a := range p["allergies"].([]any) {
			allergySet[asDiningString(a)] = struct{}{}
		}
		for _, r := range p["restrictions"].([]any) {
			restrictionSet[asDiningString(r)] = struct{}{}
		}
	}
	allergies := make([]string, 0, len(allergySet))
	for k := range allergySet {
		allergies = append(allergies, k)
	}
	restrictions := make([]string, 0, len(restrictionSet))
	for k := range restrictionSet {
		restrictions = append(restrictions, k)
	}

	resp := map[string]any{
		"householdId": householdID, "totalServings": totalServings, "participants": participants,
		"allergies": allergies, "restrictions": restrictions, "recipeValidationRequired": true,
	}
	if recipeCheck != nil {
		resp["recipeCheck"] = recipeCheck
	}
	if planItemOut != nil {
		resp["planItem"] = planItemOut
	}

	if recipeCheck != nil {
		materials, _ := recipeCheck["materials"].(map[string]any)
		if materials != nil && materials["status"] == "known" {
			demandMaps, _ := materials["demands"].([]any)
			demands := make([]recipeDemand, 0, len(demandMaps))
			for _, raw := range demandMaps {
				d, _ := raw.(map[string]any)
				amt, _ := d["amount_value"].(float64)
				demands = append(demands, recipeDemand{
					foodName: asDiningString(d["food_name"]), amountValue: amt, unit: asDiningString(d["unit"]),
				})
			}
			coverage, netShopping := h.householdInventoryCoverage(householdID, demands)
			resp["coverage"] = coverage
			if len(netShopping) > 0 {
				resp["netShopping"] = map[string]any{
					"status": "needs_review", "lines": netShopping,
					"checks": []string{"部分原料需从家庭库存外补足"},
				}
			}
			warnings := make([]map[string]any, 0)
			if conflicts, ok := recipeCheck["conflicts"].([]any); ok {
				for _, raw := range conflicts {
					cfl, _ := raw.(map[string]any)
					if cfl != nil && cfl["kind"] == "allergy" {
						warnings = append(warnings, cfl)
					}
				}
			}
			if len(warnings) > 0 {
				resp["allergenWarnings"] = warnings
			}
			if supplyEligible && planItemOut != nil && planItemOut["decision"] != "keep" {
				supplyDemands := make([]map[string]any, 0, len(demands))
				for _, d := range demands {
					var covered, missing any = nil, nil
					for _, cov := range coverage {
						if asDiningString(cov["food_name"]) == d.foodName {
							covered = cov["covered"]
							req, _ := cov["required"].(float64)
							covAmt, _ := cov["covered"].(float64)
							missing = roundDining(math.Max(0, req-covAmt))
							break
						}
					}
					supplyDemands = append(supplyDemands, map[string]any{
						"food_name": d.foodName, "amount_value": d.amountValue, "unit": d.unit,
						"covered": covered, "missing": missing, "shoppingCovered": nil, "unplanned": missing,
					})
				}
				resp["supply"] = map[string]any{
					"status": "known", "otherMealCount": 0, "checks": []string{},
					"demands": supplyDemands,
				}
			}
		}
	}
	c.JSON(http.StatusOK, resp)
}

func toAnyList(items []string) []any {
	out := make([]any, len(items))
	for i, s := range items {
		out[i] = s
	}
	return out
}
