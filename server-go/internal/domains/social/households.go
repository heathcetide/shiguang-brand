// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) MineHouseholds(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	rows, err := h.DB.Query(`SELECT h.id, h.name, COALESCE(h.invite_code,''), COALESCE(h.owner_id, 0),
		COALESCE(h.created_at,''), hm.role FROM households h
		JOIN household_members hm ON hm.household_id=h.id WHERE hm.user_id=? ORDER BY h.id DESC`, userID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	type hhRow struct {
		id, ownerID                    int
		name, invite, created, myRole string
	}
	pending := make([]hhRow, 0)
	for rows.Next() {
		var r hhRow
		if rows.Scan(&r.id, &r.name, &r.invite, &r.ownerID, &r.created, &r.myRole) != nil {
			continue
		}
		pending = append(pending, r)
	}
	_ = rows.Close()
	list := make([]map[string]any, 0, len(pending))
	for _, r := range pending {
		list = append(list, map[string]any{
			"id": r.id, "name": r.name, "invite_code": r.invite, "owner_id": r.ownerID,
			"created_at": r.created, "my_role": r.myRole, "members": h.householdMembersList(r.id),
		})
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) householdMembersList(householdID int) []map[string]any {
	rows, err := h.DB.Query(`SELECT u.id, u.username, COALESCE(u.nickname,u.username), u.avatar_url, hm.role, COALESCE(hm.joined_at,'')
		FROM household_members hm JOIN users u ON u.id=hm.user_id WHERE hm.household_id=? ORDER BY hm.id`, householdID)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var uid int
		var username, nickname, avatar, role, joined sql.NullString
		if rows.Scan(&uid, &username, &nickname, &avatar, &role, &joined) == nil {
			out = append(out, map[string]any{
				"user_id": uid, "username": nullStr(username), "nickname": nullStr(nickname),
				"avatar_url": nullStr(avatar), "role": nullStr(role), "joined_at": nullStr(joined),
			})
		}
	}
	return out
}

func (h *Handlers) JoinHousehold(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	code := strings.ToUpper(strField(body, "invite_code", "inviteCode"))
	if code == "" {
		httpx.SendError(c, http.StatusBadRequest, "邀请码无效", "INVALID_INVITE")
		return
	}
	var hhID int
	err := h.DB.QueryRow(`SELECT id FROM households WHERE invite_code=?`, code).Scan(&hhID)
	var name, invite string
	var ownerID int
	if err != nil {
		httpx.SendError(c, 440, "未找到对应的家庭空间，请检查邀请码是否正确", "HOUSEHOLD_NOT_FOUND")
		return
	}
	err = h.DB.QueryRow(`SELECT name, COALESCE(invite_code,''), COALESCE(owner_id, owner_user_id, 0) FROM households WHERE id=?`, hhID).
		Scan(&name, &invite, &ownerID)
	if err != nil {
		httpx.SendError(c, 440, "未找到对应的家庭空间，请检查邀请码是否正确", "HOUSEHOLD_NOT_FOUND")
		return
	}
	household := map[string]any{"id": hhID, "name": name, "invite_code": invite, "owner_id": ownerID}
	if _, _, member := h.householdMember(hhID, userID); member {
		c.JSON(http.StatusOK, gin.H{"kind": "existing", "household": household})
		return
	}
	_, err = h.DB.Exec(`INSERT OR IGNORE INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')`, hhID, userID)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "加入家庭失败", "JOIN_FAILED")
		return
	}
	c.JSON(http.StatusOK, gin.H{"kind": "joined", "household": household})
}

func (h *Handlers) LeaveHousehold(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	memberID, role, isMember := h.householdMember(householdID, userID)
	if !isMember {
		c.JSON(http.StatusOK, gin.H{"kind": "not_member"})
		return
	}
	if role == "owner" {
		var nextUserID int
		var nextMemberID int
		err := h.DB.QueryRow(`SELECT id, user_id FROM household_members WHERE household_id=? AND user_id<>? ORDER BY id LIMIT 1`,
			householdID, userID).Scan(&nextMemberID, &nextUserID)
		if err != nil {
			_, _ = h.DB.Exec(`DELETE FROM households WHERE id=?`, householdID)
			c.JSON(http.StatusOK, gin.H{"kind": "dissolved"})
			return
		}
		tx, _ := h.DB.Begin()
		_, _ = tx.Exec(`UPDATE household_members SET role='owner' WHERE id=?`, nextMemberID)
		_, _ = tx.Exec(`UPDATE households SET owner_id=?, owner_user_id=?, version=COALESCE(version,1)+1 WHERE id=?`, nextUserID, nextUserID, householdID)
		_, _ = tx.Exec(`DELETE FROM household_members WHERE household_id=? AND user_id=?`, householdID, userID)
		_ = tx.Commit()
		c.JSON(http.StatusOK, gin.H{"kind": "transferred", "newOwnerUserId": nextUserID})
		_ = memberID
		return
	}
	_, _ = h.DB.Exec(`DELETE FROM household_members WHERE household_id=? AND user_id=?`, householdID, userID)
	c.JSON(http.StatusOK, gin.H{"kind": "left"})
}

func (h *Handlers) TransferHouseholdOwner(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	newOwner, ok := numField(body, "userId", "user_id")
	if !ok || newOwner <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	var ownerID int
	var version int
	err := h.DB.QueryRow(`SELECT COALESCE(owner_id, owner_user_id, 0), COALESCE(version,1) FROM households WHERE id=?`, householdID).
		Scan(&ownerID, &version)
	if err != nil || ownerID != userID {
		c.JSON(http.StatusOK, gin.H{"kind": "not_owner"})
		return
	}
	if _, _, member := h.householdMember(householdID, newOwner); !member {
		c.JSON(http.StatusOK, gin.H{"kind": "target_not_member"})
		return
	}
	wantVersion := version
	if v, ok := numField(body, "version"); ok {
		wantVersion = v
	}
	res, err := h.DB.Exec(`UPDATE households SET owner_id=?, owner_user_id=?, version=version+1
		WHERE id=? AND COALESCE(owner_id, owner_user_id)=? AND COALESCE(version,1)=?`,
		newOwner, newOwner, householdID, userID, wantVersion)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "转让失败", "TRANSFER_FAILED")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		c.JSON(http.StatusOK, gin.H{"kind": "version_conflict"})
		return
	}
	_, _ = h.DB.Exec(`UPDATE household_members SET role='member' WHERE household_id=? AND user_id=?`, householdID, userID)
	_, _ = h.DB.Exec(`UPDATE household_members SET role='owner' WHERE household_id=? AND user_id=?`, householdID, newOwner)
	c.JSON(http.StatusOK, gin.H{"kind": "transferred", "version": wantVersion + 1})
}

func (h *Handlers) DiningAllocationPreview(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	if _, _, member := h.householdMember(householdID, userID); !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	h.previewDiningAllocation(c, userID, householdID, body)
}

func (h *Handlers) DiningMembers(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	if _, _, member := h.householdMember(householdID, userID); !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	rows, err := h.DB.Query(`SELECT hm.id, hm.user_id, COALESCE(u.nickname,u.username) AS name,
		COALESCE(hm.dining_shared,0), COALESCE(hm.dining_version,1),
		CASE WHEN COALESCE(hm.dining_shared,0)=1 THEN hm.dining_preferences_json ELSE NULL END
		FROM household_members hm JOIN users u ON u.id=hm.user_id
		WHERE hm.household_id=? ORDER BY hm.id`, householdID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, uid, shared, dver int
		var name string
		var prefs sql.NullString
		if rows.Scan(&id, &uid, &name, &shared, &dver, &prefs) == nil {
			list = append(list, map[string]any{
				"id": id, "user_id": uid, "name": name, "dining_shared": shared == 1,
				"dining_version": dver, "dining_preferences_json": nullStr(prefs),
			})
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) GetDiningPreferences(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	var memberID, shared, dver int
	var prefs string
	err := h.DB.QueryRow(`SELECT id, COALESCE(dining_shared,0), COALESCE(dining_preferences_json,'{}'), COALESCE(dining_version,1)
		FROM household_members WHERE household_id=? AND user_id=?`, householdID, userID).
		Scan(&memberID, &shared, &prefs, &dver)
	if err != nil {
		c.JSON(http.StatusOK, nil)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": memberID, "dining_shared": shared == 1, "dining_preferences_json": prefs, "dining_version": dver,
	})
}

func (h *Handlers) PutDiningPreferences(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	shared := 0
	if v, ok := body["shared"].(bool); ok && v {
		shared = 1
	}
	prefs := map[string]any{
		"allergies":    body["allergies"],
		"restrictions": body["restrictions"],
	}
	prefsJSON, _ := json.Marshal(prefs)
	membershipID, _ := numField(body, "membershipId", "membership_id")
	version, _ := numField(body, "version")
	if membershipID == 0 {
		membershipID, _, _ = h.householdMember(householdID, userID)
	}
	res, err := h.DB.Exec(`UPDATE household_members SET dining_shared=?, dining_preferences_json=?, dining_version=dining_version+1
		WHERE household_id=? AND user_id=? AND id=? AND COALESCE(dining_version,1)=?`,
		shared, string(prefsJSON), householdID, userID, membershipID, version)
	if err != nil || mustRows(res) != 1 {
		httpx.SendError(c, http.StatusConflict, "共餐偏好已变化，请重新加载", "VERSION_CONFLICT")
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version + 1})
}

func (h *Handlers) HouseholdHistory(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	if _, _, member := h.householdMember(householdID, userID); !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	rows, err := h.DB.Query(`SELECT id, operator_user_id, action, COALESCE(food_name,''), COALESCE(quantity,''),
		COALESCE(storage_location,''), COALESCE(created_at,'') FROM household_activity_logs
		WHERE household_id=? ORDER BY id DESC LIMIT 100`, householdID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, operator int
		var action, food, qty, loc, created string
		if rows.Scan(&id, &operator, &action, &food, &qty, &loc, &created) == nil {
			list = append(list, map[string]any{
				"id": id, "operator_user_id": operator, "action": action, "food_name": food,
				"quantity": qty, "storage_location": loc, "created_at": created,
			})
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) inventoryTable() string {
	var n int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='household_inventory_items'`).Scan(&n)
	if n > 0 {
		return "household_inventory_items"
	}
	return "household_inventory"
}

func (h *Handlers) ListHouseholdInventory(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	if _, _, member := h.householdMember(householdID, userID); !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	tbl := h.inventoryTable()
	q := fmt.Sprintf(`SELECT id, food_name, category, quantity, expiration_date, storage_location, image_url,
		is_available, COALESCE(version,1), created_by_user_id, COALESCE(created_at,'') FROM %s WHERE household_id=? ORDER BY id DESC`, tbl)
	rows, err := h.DB.Query(q, householdID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, avail, ver, creator int
		var food, cat, qty, exp, loc, img, created sql.NullString
		if rows.Scan(&id, &food, &cat, &qty, &exp, &loc, &img, &avail, &ver, &creator, &created) == nil {
			list = append(list, map[string]any{
				"id": id, "food_name": nullStr(food), "category": nullStr(cat), "quantity": nullStr(qty),
				"expiration_date": nullStr(exp), "storage_location": nullStr(loc), "image_url": nullStr(img),
				"is_available": avail == 1, "version": ver, "created_by_user_id": creator, "created_at": nullStr(created),
			})
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CreateHouseholdInventory(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	if _, _, member := h.householdMember(householdID, userID); !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	food := strField(body, "food_name", "foodName")
	if food == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	tbl := h.inventoryTable()
	exp := strField(body, "expiration_date", "expirationDate")
	if exp == "" {
		exp = "2099-12-31"
	}
	cat := strField(body, "category")
	if cat == "" {
		cat = "其他"
	}
	qty := strField(body, "quantity")
	if qty == "" {
		qty = "1"
	}
	loc := strField(body, "storage_location", "storageLocation")
	if loc == "" {
		loc = "冷藏"
	}
	res, err := h.DB.Exec(fmt.Sprintf(`INSERT INTO %s
		(household_id, created_by_user_id, food_name, category, quantity, expiration_date, storage_location, image_url)
		VALUES (?,?,?,?,?,?,?,?)`, tbl), householdID, userID, food, cat, qty, exp, loc, strField(body, "image_url", "imageUrl"))
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建库存失败", "INVENTORY_FAILED")
		return
	}
	id, _ := res.LastInsertId()
	h.logActivity(householdID, userID, "inventory_add", food, qty, loc)
	c.JSON(http.StatusCreated, gin.H{"id": id, "food_name": food, "version": 1, "is_available": true})
}

func (h *Handlers) UpdateHouseholdInventory(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	itemID, _ := strconv.Atoi(c.Param("itemId"))
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	if _, _, member := h.householdMember(householdID, userID); !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	tbl := h.inventoryTable()
	version, _ := numField(body, "version")
	res, err := h.DB.Exec(fmt.Sprintf(`UPDATE %s SET
		food_name=COALESCE(NULLIF(?,''), food_name),
		category=COALESCE(NULLIF(?,''), category),
		quantity=COALESCE(NULLIF(?,''), quantity),
		expiration_date=COALESCE(NULLIF(?,''), expiration_date),
		storage_location=COALESCE(NULLIF(?,''), storage_location),
		is_available=COALESCE(?, is_available),
		version=version+1, updated_at=CURRENT_TIMESTAMP
		WHERE id=? AND household_id=? AND COALESCE(version,1)=?`, tbl),
		strField(body, "food_name"), strField(body, "category"), strField(body, "quantity"),
		strField(body, "expiration_date"), strField(body, "storage_location"),
		boolField(body, "is_available"), itemID, householdID, version)
	if err != nil || mustRows(res) != 1 {
		c.JSON(http.StatusOK, gin.H{"kind": "version_conflict"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kind": "completed", "item": gin.H{"id": itemID, "version": version + 1}})
}

func (h *Handlers) DeleteHouseholdInventory(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	itemID, _ := strconv.Atoi(c.Param("itemId"))
	if _, _, member := h.householdMember(householdID, userID); !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	ver, _ := strconv.Atoi(c.Query("version"))
	tbl := h.inventoryTable()
	res, _ := h.DB.Exec(fmt.Sprintf(`DELETE FROM %s WHERE id=? AND household_id=? AND (?=0 OR COALESCE(version,1)=?)`, tbl),
		itemID, householdID, ver, ver)
	if mustRows(res) != 1 {
		c.JSON(http.StatusOK, "not_found")
		return
	}
	c.JSON(http.StatusOK, "deleted")
}

func (h *Handlers) ListHouseholdMeals(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	memberID, _, member := h.householdMember(householdID, userID)
	if !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	rows, err := h.DB.Query(`SELECT id, food_name, produced_servings, remaining_servings, COALESCE(version,1), COALESCE(created_at,'')
		FROM household_meals WHERE household_id=? ORDER BY created_at DESC LIMIT 100`, householdID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	type mealRow struct {
		id, ver                int
		food, created          string
		produced, remaining    float64
	}
	pending := make([]mealRow, 0)
	for rows.Next() {
		var r mealRow
		if rows.Scan(&r.id, &r.food, &r.produced, &r.remaining, &r.ver, &r.created) == nil {
			pending = append(pending, r)
		}
	}
	_ = rows.Close()
	list := make([]map[string]any, 0, len(pending))
	for _, r := range pending {
		var reservedMine float64
		_ = h.DB.QueryRow(`SELECT COALESCE(servings,0) FROM household_meal_reservations WHERE meal_id=? AND membership_id=?`,
			r.id, memberID).Scan(&reservedMine)
		list = append(list, map[string]any{
			"id": r.id, "food_name": r.food, "produced_servings": r.produced, "remaining_servings": r.remaining,
			"version": r.ver, "created_at": r.created, "reserved_mine": reservedMine,
		})
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CreateHouseholdMeal(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	memberID, _, member := h.householdMember(householdID, userID)
	if !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	food := strField(body, "foodName", "food_name")
	servings := 1.0
	if v, ok := body["producedServings"].(float64); ok && v > 0 {
		servings = v
	} else if v, ok := body["produced_servings"].(float64); ok && v > 0 {
		servings = v
	}
	recipeID, hasRecipe := numField(body, "recipeId", "recipe_id")
	var recipeIngredients string
	if hasRecipe && recipeID > 0 {
		if recipe, ok := h.diningRecipeRow(recipeID); ok {
			if food == "" {
				food = asDiningString(recipe["title"])
			}
			recipeIngredients = asDiningString(recipe["ingredients_json"])
			body["recipe_id"] = recipeID
			body["ingredients_json"] = recipeIngredients
		}
	}
	if food == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	id := newUUID()
	if invLines, ok := body["inventory"].([]any); ok && len(invLines) > 0 {
		tx, err := h.DB.Begin()
		if err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "创建餐次失败", "MEAL_FAILED")
			return
		}
		tbl := h.inventoryTable()
		for _, raw := range invLines {
			line, ok := raw.(map[string]any)
			if !ok {
				tx.Rollback()
				httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
				return
			}
			itemID, _ := numField(line, "itemId", "item_id")
			ver, _ := numField(line, "version")
			amount := 0.0
			if v, ok := line["amount"].(float64); ok {
				amount = v
			}
			unit := strField(line, "unit")
			if itemID <= 0 || ver <= 0 || amount <= 0 || unit == "" {
				continue
			}
			var qty, itemFood string
			var currentVer int
			err := tx.QueryRow(fmt.Sprintf(`SELECT food_name, quantity, COALESCE(version,1) FROM %s WHERE id=? AND household_id=?`, tbl), itemID, householdID).
				Scan(&itemFood, &qty, &currentVer)
			if err != nil || currentVer != ver {
				tx.Rollback()
				httpx.SendError(c, http.StatusConflict, "库存已变化，请刷新后重试", "INVENTORY_CONFLICT")
				return
			}
			parsed := recipeDemands([]ingredientLine{{name: itemFood, amount: strings.TrimSpace(qty)}}, 1, 1)
			if len(parsed) != 1 || parsed[0].unit != unit {
				tx.Rollback()
				httpx.SendError(c, http.StatusConflict, "库存单位无法换算", "INVENTORY_CONFLICT")
				return
			}
			nextVal := roundDining(math.Max(0, parsed[0].amountValue-amount))
			nextQty := fmt.Sprintf("%g%s", nextVal, unitLabel(unit))
			avail := 1
			if nextVal <= 0 {
				avail = 0
			}
			res, err := tx.Exec(fmt.Sprintf(`UPDATE %s SET quantity=?, is_available=?, version=version+1, updated_at=CURRENT_TIMESTAMP
				WHERE id=? AND household_id=? AND COALESCE(version,1)=?`, tbl), nextQty, avail, itemID, householdID, ver)
			if err != nil || mustRows(res) != 1 {
				tx.Rollback()
				httpx.SendError(c, http.StatusConflict, "库存已变化，请刷新后重试", "INVENTORY_CONFLICT")
				return
			}
		}
		payload, _ := json.Marshal(body)
		_, err = tx.Exec(`INSERT INTO household_meals (id, household_id, created_by_user_id, membership_id, food_name, produced_servings, remaining_servings, payload_json)
			VALUES (?,?,?,?,?,?,?,?)`, id, householdID, userID, memberID, food, servings, servings, string(payload))
		if err != nil {
			tx.Rollback()
			httpx.SendError(c, http.StatusInternalServerError, "创建餐次失败", "MEAL_FAILED")
			return
		}
		if err := tx.Commit(); err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "创建餐次失败", "MEAL_FAILED")
			return
		}
		c.JSON(http.StatusCreated, gin.H{"id": id, "food_name": food, "remaining_servings": servings, "version": 1})
		return
	}
	payload, _ := json.Marshal(body)
	_, err := h.DB.Exec(`INSERT INTO household_meals (id, household_id, created_by_user_id, membership_id, food_name, produced_servings, remaining_servings, payload_json)
		VALUES (?,?,?,?,?,?,?,?)`, id, householdID, userID, memberID, food, servings, servings, string(payload))
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建餐次失败", "MEAL_FAILED")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "food_name": food, "remaining_servings": servings, "version": 1})
}

func unitLabel(unit string) string {
	switch unit {
	case "g":
		return "g"
	case "kg":
		return "kg"
	case "ml":
		return "ml"
	case "l":
		return "l"
	case "piece":
		return "个"
	case "serving":
		return "份"
	default:
		return unit
	}
}

func (h *Handlers) EatHouseholdMeal(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	mealID := c.Param("mealId")
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	_, _, member := h.householdMember(householdID, userID)
	if !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	servings := 1.0
	if v, ok := body["servings"].(float64); ok && v > 0 {
		servings = v
	}
	var remaining float64
	err := h.DB.QueryRow(`SELECT remaining_servings FROM household_meals WHERE id=? AND household_id=?`, mealID, householdID).Scan(&remaining)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "家庭待吃餐不存在", "MEAL_NOT_FOUND")
		return
	}
	next := remaining - servings
	if next < 0 {
		next = 0
	}
	ver, _ := numField(body, "version")
	_, _ = h.DB.Exec(`UPDATE household_meals SET remaining_servings=?, version=version+1, updated_at=CURRENT_TIMESTAMP
		WHERE id=? AND household_id=?`, next, mealID, householdID)
	c.JSON(http.StatusOK, gin.H{"meal": gin.H{"id": mealID, "remaining_servings": next, "version": ver + 1}, "repeated": false})
}

func (h *Handlers) ReserveHouseholdMeal(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	mealID := c.Param("mealId")
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	membershipID, _ := numField(body, "membershipId", "membership_id")
	if membershipID == 0 {
		membershipID, _, _ = h.householdMember(householdID, userID)
	}
	servings := 0.0
	if v, ok := body["servings"].(float64); ok {
		servings = v
	}
	version, _ := numField(body, "version")
	if servings > 0 {
		_, _ = h.DB.Exec(`INSERT INTO household_meal_reservations (meal_id, membership_id, servings) VALUES (?,?,?)
			ON CONFLICT(meal_id, membership_id) DO UPDATE SET servings=excluded.servings`, mealID, membershipID, servings)
	} else {
		_, _ = h.DB.Exec(`DELETE FROM household_meal_reservations WHERE meal_id=? AND membership_id=?`, mealID, membershipID)
	}
	_, _ = h.DB.Exec(`UPDATE household_meals SET version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND household_id=?`, mealID, householdID)
	c.JSON(http.StatusOK, gin.H{"version": version + 1, "myReservedServings": servings})
}

func (h *Handlers) ListHouseholdShopping(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	if _, _, member := h.householdMember(householdID, userID); !member {
		httpx.SendError(c, http.StatusForbidden, "你不是该家庭的成员", "NOT_MEMBER")
		return
	}
	rows, err := h.DB.Query(`SELECT id, name, amount, category, checked, storage_location, expiration_date, version,
		created_by_user_id, updated_by_user_id, COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM household_shopping_items WHERE household_id=? AND deleted_at IS NULL ORDER BY checked, updated_at DESC`, householdID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var checked, ver, creator, editor int
		var id, name, amount, cat, loc, exp, created, updated sql.NullString
		if rows.Scan(&id, &name, &amount, &cat, &checked, &loc, &exp, &ver, &creator, &editor, &created, &updated) == nil {
			list = append(list, map[string]any{
				"id": nullStr(id), "name": nullStr(name), "amount": nullStr(amount), "category": nullStr(cat),
				"checked": checked == 1, "storageLocation": nullStr(loc), "expirationDate": nullStr(exp),
				"version": ver, "created_by_user_id": creator, "updated_by_user_id": editor,
				"createdAt": nullStr(created), "updatedAt": nullStr(updated),
			})
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CreateHouseholdShopping(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	if _, _, member := h.householdMember(householdID, userID); !member {
		c.JSON(http.StatusOK, gin.H{"kind": "not_member"})
		return
	}
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	name := strField(body, "name")
	if name == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	id := newUUID()
	amount := strField(body, "amount")
	if amount == "" {
		amount = "适量"
	}
	cat := strField(body, "category")
	if cat == "" {
		cat = "其他"
	}
	_, err := h.DB.Exec(`INSERT INTO household_shopping_items
		(id, household_id, name, amount, category, storage_location, expiration_date, created_by_user_id, updated_by_user_id)
		VALUES (?,?,?,?,?,?,?,?,?)`, id, householdID, name, amount, cat,
		strField(body, "storageLocation", "storage_location"), strField(body, "expirationDate", "expiration_date"), userID, userID)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建购物项失败", "SHOPPING_FAILED")
		return
	}
	h.logActivity(householdID, userID, "shopping_add", name, amount, strField(body, "storageLocation"))
	active, _ := h.shoppingActive(householdID)
	c.JSON(http.StatusCreated, gin.H{"kind": "created", "item": gin.H{"id": id, "name": name, "version": 1}, "active": active})
}

func (h *Handlers) shoppingActive(householdID int) ([]map[string]any, error) {
	rows, err := h.DB.Query(`SELECT id, name, amount, category FROM household_shopping_items
		WHERE household_id=? AND deleted_at IS NULL`, householdID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var id, name, amount, cat string
		if rows.Scan(&id, &name, &amount, &cat) == nil {
			out = append(out, map[string]any{"id": id, "name": name, "amount": amount, "category": cat})
		}
	}
	return out, nil
}

func (h *Handlers) UpdateHouseholdShopping(c *gin.Context) {
	h.updateHouseholdShopping(c, false)
}

func (h *Handlers) PatchHouseholdShopping(c *gin.Context) {
	h.updateHouseholdShopping(c, true)
}

func (h *Handlers) updateHouseholdShopping(c *gin.Context, _ bool) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	itemID := c.Param("itemId")
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	if _, _, member := h.householdMember(householdID, userID); !member {
		c.JSON(http.StatusOK, gin.H{"kind": "not_member"})
		return
	}
	version, _ := numField(body, "version")
	checked := -1
	if v, ok := body["checked"].(bool); ok {
		if v {
			checked = 1
		} else {
			checked = 0
		}
	}
	res, err := h.DB.Exec(`UPDATE household_shopping_items SET
		name=COALESCE(NULLIF(?,''), name), amount=COALESCE(NULLIF(?,''), amount),
		category=COALESCE(NULLIF(?,''), category),
		storage_location=COALESCE(NULLIF(?,''), storage_location),
		expiration_date=COALESCE(NULLIF(?,''), expiration_date),
		checked=CASE WHEN ?<0 THEN checked ELSE ? END,
		updated_by_user_id=?, version=version+1, updated_at=CURRENT_TIMESTAMP
		WHERE id=? AND household_id=? AND deleted_at IS NULL AND version=?`,
		strField(body, "name"), strField(body, "amount"), strField(body, "category"),
		strField(body, "storageLocation"), strField(body, "expirationDate"), checked, checked,
		userID, itemID, householdID, version)
	if err != nil || mustRows(res) != 1 {
		c.JSON(http.StatusOK, gin.H{"kind": "version_conflict"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kind": "updated", "item": gin.H{"id": itemID, "version": version + 1}})
}

func (h *Handlers) DeleteHouseholdShopping(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	itemID := c.Param("itemId")
	if _, _, member := h.householdMember(householdID, userID); !member {
		c.JSON(http.StatusOK, "not_member")
		return
	}
	ver, _ := strconv.Atoi(c.Query("version"))
	res, _ := h.DB.Exec(`UPDATE household_shopping_items SET deleted_at=CURRENT_TIMESTAMP
		WHERE id=? AND household_id=? AND deleted_at IS NULL AND (?=0 OR version=?)`, itemID, householdID, ver, ver)
	if mustRows(res) != 1 {
		c.JSON(http.StatusOK, "version_conflict")
		return
	}
	_ = userID
	c.JSON(http.StatusOK, "deleted")
}

func (h *Handlers) ShoppingIntake(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	householdID, ok := parseHouseholdID(c)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "家庭 ID 无效", "INVALID_ID")
		return
	}
	if _, _, member := h.householdMember(householdID, userID); !member {
		c.JSON(http.StatusOK, gin.H{"kind": "not_member"})
		return
	}
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	batchID := newUUID()
	items, _ := body["items"].([]any)
	inventoryIDs := make([]int, 0)
	tbl := h.inventoryTable()
	for _, raw := range items {
		m, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := strField(m, "name")
		if name == "" {
			name = "待分类食材"
		}
		qty := strField(m, "quantity")
		if qty == "" {
			qty = "1"
		}
		exp := strField(m, "expirationDate", "expiration_date")
		if exp == "" {
			exp = "2099-12-31"
		}
		loc := strField(m, "storageLocation", "storage_location")
		if loc == "" {
			loc = "冷藏"
		}
		res, err := h.DB.Exec(fmt.Sprintf(`INSERT INTO %s
			(household_id, created_by_user_id, food_name, category, quantity, expiration_date, storage_location)
			VALUES (?,?,?,?,?,?,?)`, tbl), householdID, userID, name, "其他", qty, exp, loc)
		if err == nil {
			id, _ := res.LastInsertId()
			inventoryIDs = append(inventoryIDs, int(id))
		}
	}
	c.JSON(http.StatusCreated, gin.H{
		"body": gin.H{"batchId": batchID, "inventoryIds": inventoryIDs, "count": len(inventoryIDs), "repeated": false},
		"status": 201,
	})
}

func (h *Handlers) logActivity(householdID, userID int, action, food, qty, loc string) {
	_, _ = h.DB.Exec(`INSERT INTO household_activity_logs (household_id, operator_user_id, action, food_name, quantity, storage_location)
		VALUES (?,?,?,?,?,?)`, householdID, userID, action, food, qty, loc)
}

func mustRows(res sql.Result) int64 {
	if res == nil {
		return 0
	}
	n, _ := res.RowsAffected()
	return n
}

func boolField(body map[string]any, key string) any {
	if v, ok := body[key]; ok {
		if b, ok := v.(bool); ok {
			if b {
				return 1
			}
			return 0
		}
	}
	return nil
}
