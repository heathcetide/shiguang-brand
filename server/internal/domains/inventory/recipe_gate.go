// Copyright (c) 2026 heathcetide. All rights reserved.
package inventory

import "github.com/heathcetide/DietDigiDose/internal/dbx"

// Reference recipes may be read by their ID, but may not drive business writes.
// A flag stored by an importer is not a safety boundary unless checked here.
func CheckRecipeExecution(db *dbx.DB, recipeID int) error {
	if recipeID <= 0 || !db.HasColumn("recipes", "automatic_inventory_write_allowed") {
		return nil
	}
	var allowed int
	if err := db.QueryRow(`SELECT automatic_inventory_write_allowed FROM recipes WHERE id=?`, recipeID).Scan(&allowed); err != nil {
		return &APIError{Status: 409, Message: "菜谱不存在或执行资格无法核对", Code: "RECIPE_EXECUTION_UNVERIFIED"}
	}
	if allowed != 1 {
		return &APIError{Status: 409, Message: "此菜谱仅供参考，尚未通过执行审核", Code: "RECIPE_EXECUTION_NOT_ALLOWED"}
	}
	return nil
}
