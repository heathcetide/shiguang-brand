// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) RecipesMine(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	where := "author_user_id = ?"
	args := []any{userID}
	if h.hasColumn("recipes", "source") {
		where += " AND source = 'user'"
	}
	if h.hasColumn("recipes", "deleted_at") {
		where += " AND deleted_at IS NULL"
	}
	order := "id DESC"
	if h.hasColumn("recipes", "updated_at") {
		order = "updated_at DESC, id DESC"
	}
	rows, err := h.DB.Query(`SELECT `+h.recipeListSelect()+` FROM recipes WHERE `+where+` ORDER BY `+order, args...)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取菜谱失败", "RECIPES_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	if err := h.appendRecipeCard(&list, rows); err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取菜谱失败", "RECIPES_FAILED")
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) RecipesLibrarySummary(c *gin.Context) {
	userID, loggedIn := expressauth.UserID(c)
	boundary := h.recipePublicWhere("")
	boundary = strings.ReplaceAll(boundary, "r.", "")
	official, community := 0, 0
	if h.hasColumn("recipes", "source") {
		row := h.DB.QueryRow(`SELECT
			SUM(CASE WHEN source <> 'user' THEN 1 ELSE 0 END),
			SUM(CASE WHEN source = 'user' THEN 1 ELSE 0 END)
			FROM recipes WHERE ` + boundary)
		_ = row.Scan(&official, &community)
	} else {
		var total int
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipes WHERE ` + boundary).Scan(&total)
		official = total
	}
	personal, favorites := 0, 0
	if loggedIn && userID > 0 {
		if h.hasTable("recipe_favorites") {
			_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipe_favorites f JOIN recipes r ON r.id = f.recipe_id
				WHERE f.user_id = ? AND `+h.recipePublicWhere("r"), userID).Scan(&favorites)
		}
		personalQuery := `SELECT COUNT(*) FROM recipes r WHERE ` + h.recipePublicWhere("r")
		args := []any{}
		if h.hasColumn("recipes", "author_user_id") {
			personalQuery += ` AND (r.author_user_id = ?`
			args = append(args, userID)
			if h.hasTable("recipe_favorites") {
				personalQuery += ` OR EXISTS (SELECT 1 FROM recipe_favorites f WHERE f.recipe_id = r.id AND f.user_id = ?))`
				args = append(args, userID)
			} else {
				personalQuery += `)`
			}
			_ = h.DB.QueryRow(personalQuery, args...).Scan(&personal)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"official": official, "community": community, "personal": personal, "favorites": favorites,
		"publicTotal":   official + community,
		"scopeContract": "approved_non_deleted_quality_checked_v1",
		"household":     gin.H{"supported": false, "count": 0},
	})
}

func (h *Handlers) RecipesFavorites(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	if !h.hasTable("recipe_favorites") {
		c.JSON(http.StatusOK, []any{})
		return
	}
	where := h.recipePublicWhere("r")
	order := "id DESC"
	subOrder := ""
	if h.hasColumn("recipe_favorites", "created_at") {
		subOrder = " ORDER BY created_at DESC"
	}
	rows, err := h.DB.Query(`SELECT `+h.recipeListSelect()+` FROM recipes WHERE id IN (
		SELECT recipe_id FROM recipe_favorites WHERE user_id = ?`+subOrder+`) AND `+strings.ReplaceAll(where, "r.", "")+` ORDER BY `+order, userID)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取收藏失败", "FAVORITES_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	if err := h.appendRecipeCard(&list, rows); err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取收藏失败", "FAVORITES_FAILED")
		return
	}
	for i := range list {
		list[i]["is_favorited"] = true
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) RecipesFavoriteCount(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	if !h.hasTable("recipe_favorites") {
		c.JSON(http.StatusOK, gin.H{"count": 0})
		return
	}
	var count int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipe_favorites f JOIN recipes r ON r.id = f.recipe_id
		WHERE f.user_id = ? AND `+h.recipePublicWhere("r"), userID).Scan(&count)
	c.JSON(http.StatusOK, gin.H{"count": count})
}

func (h *Handlers) RecipesFavoriteStatus(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, ok := parsePositiveID(c, "id")
	if !ok {
		return
	}
	var n int
	if h.hasTable("recipe_favorites") {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipe_favorites WHERE user_id=? AND recipe_id=?`, userID, id).Scan(&n)
	}
	c.JSON(http.StatusOK, gin.H{"is_favorited": n > 0})
}

func (h *Handlers) RecipesListSubmissions(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	where := "author_user_id = ?"
	args := []any{userID}
	if h.hasColumn("recipes", "source") {
		where += " AND source = 'user'"
	}
	if h.hasColumn("recipes", "deleted_at") {
		where += " AND deleted_at IS NULL"
	}
	rows, err := h.DB.Query(`SELECT `+h.recipeListSelect()+` FROM recipes WHERE `+where+` ORDER BY id DESC`, args...)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取投稿失败", "SUBMISSIONS_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	if err := h.appendRecipeCard(&list, rows); err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取投稿失败", "SUBMISSIONS_FAILED")
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) RecipesCreateSubmission(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	title := asString(body["title"])
	if len(title) < 2 {
		httpx.SendError(c, http.StatusBadRequest, "食谱标题需为 2-80 个字符", "INVALID_BODY")
		return
	}
	id, err := h.insertRecipeSubmission(userID, body)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "投稿失败", "SUBMISSION_FAILED")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "id": id, "status": "pending", "message": "食谱投稿成功，等待管理员审核"})
}

func (h *Handlers) RecipesUpdateSubmission(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, ok := parsePositiveID(c, "id")
	if !ok {
		return
	}
	if !h.userOwnsSubmission(userID, id) {
		httpx.SendError(c, http.StatusNotFound, "未找到该投稿", "SUBMISSION_NOT_FOUND")
		return
	}
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	if err := h.updateRecipeSubmission(userID, id, body); err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新投稿失败", "SUBMISSION_FAILED")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "status": "pending", "message": "投稿已更新并重新进入审核"})
}

func (h *Handlers) RecipesDeleteSubmission(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, ok := parsePositiveID(c, "id")
	if !ok {
		return
	}
	if !h.withdrawSubmission(userID, id) {
		httpx.SendError(c, http.StatusNotFound, "未找到该投稿", "SUBMISSION_NOT_FOUND")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "投稿已撤回"})
}

func (h *Handlers) userOwnsSubmission(userID, recipeID int) bool {
	where := "id = ? AND author_user_id = ?"
	args := []any{recipeID, userID}
	if h.hasColumn("recipes", "source") {
		where += " AND source = 'user'"
	}
	if h.hasColumn("recipes", "deleted_at") {
		where += " AND deleted_at IS NULL"
	}
	var id int
	err := h.DB.QueryRow(`SELECT id FROM recipes WHERE `+where, args...).Scan(&id)
	return err == nil
}

func (h *Handlers) withdrawSubmission(userID, recipeID int) bool {
	if h.hasColumn("recipes", "deleted_at") {
		res, err := h.DB.Exec(`UPDATE recipes SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
			WHERE id=? AND author_user_id=?`, recipeID, userID)
		if err != nil {
			return false
		}
		n, _ := res.RowsAffected()
		return n == 1
	}
	res, err := h.DB.Exec(`DELETE FROM recipes WHERE id=? AND author_user_id=?`, recipeID, userID)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

func (h *Handlers) insertRecipeSubmission(userID int, body map[string]any) (int64, error) {
	title := asString(body["title"])
	ingredients, _ := json.Marshal(body["ingredients"])
	if len(ingredients) == 0 {
		ingredients, _ = json.Marshal(body["ingredients_json"])
	}
	steps, _ := json.Marshal(body["steps"])
	if len(steps) == 0 {
		steps, _ = json.Marshal(body["steps_json"])
	}
	cols := []string{"title"}
	vals := []any{title}
	holders := []string{"?"}
	if h.hasColumn("recipes", "ingredients_json") {
		cols, vals, holders = append(cols, "ingredients_json"), append(vals, string(ingredients)), append(holders, "?")
	}
	if h.hasColumn("recipes", "steps_json") {
		cols, vals, holders = append(cols, "steps_json"), append(vals, string(steps)), append(holders, "?")
	}
	if h.hasColumn("recipes", "author_user_id") {
		cols, vals, holders = append(cols, "author_user_id"), append(vals, userID), append(holders, "?")
	}
	if h.hasColumn("recipes", "source") {
		cols, vals, holders = append(cols, "source"), append(vals, "user"), append(holders, "?")
	}
	if h.hasColumn("recipes", "status") {
		cols, vals, holders = append(cols, "status"), append(vals, "pending"), append(holders, "?")
	}
	if h.hasColumn("recipes", "quality_status") {
		cols, vals, holders = append(cols, "quality_status"), append(vals, "needs_review"), append(holders, "?")
	}
	desc := asString(body["description"])
	if desc != "" && h.hasColumn("recipes", "description") {
		cols, vals, holders = append(cols, "description"), append(vals, desc), append(holders, "?")
	} else if h.hasColumn("recipes", "summary") {
		cols, vals, holders = append(cols, "summary"), append(vals, desc), append(holders, "?")
	}
	q := `INSERT INTO recipes (` + strings.Join(cols, ",") + `) VALUES (` + strings.Join(holders, ",") + `)`
	return h.DB.InsertID(q, vals...)
}

func (h *Handlers) updateRecipeSubmission(userID, recipeID int, body map[string]any) error {
	title := asString(body["title"])
	ingredients, _ := json.Marshal(body["ingredients"])
	if len(ingredients) == 0 {
		ingredients, _ = json.Marshal(body["ingredients_json"])
	}
	steps, _ := json.Marshal(body["steps"])
	if len(steps) == 0 {
		steps, _ = json.Marshal(body["steps_json"])
	}
	sets := []string{"title=?"}
	args := []any{title}
	if h.hasColumn("recipes", "ingredients_json") {
		sets, args = append(sets, "ingredients_json=?"), append(args, string(ingredients))
	}
	if h.hasColumn("recipes", "steps_json") {
		sets, args = append(sets, "steps_json=?"), append(args, string(steps))
	}
	if h.hasColumn("recipes", "status") {
		sets = append(sets, "status='pending'")
	}
	if h.hasColumn("recipes", "quality_status") {
		sets = append(sets, "quality_status='needs_review'")
	}
	if h.hasColumn("recipes", "updated_at") {
		sets = append(sets, "updated_at=CURRENT_TIMESTAMP")
	}
	args = append(args, recipeID, userID)
	where := "id=? AND author_user_id=?"
	if h.hasColumn("recipes", "source") {
		where += " AND source='user'"
	}
	_, err := h.DB.Exec(`UPDATE recipes SET `+strings.Join(sets, ",")+` WHERE `+where, args...)
	return err
}
