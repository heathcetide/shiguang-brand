// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"database/sql"
	"fmt"
	"math"
	"strings"
)

func nullFloatArg(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func scaleNutrition(perServing *float64, servings float64) *float64 {
	if perServing == nil || servings <= 0 {
		return nil
	}
	v := math.Round((*perServing)*servings*100) / 100
	return &v
}

func optionalNutritionField(record map[string]any, keys ...string) *float64 {
	for _, key := range keys {
		if v, ok := record[key]; ok {
			return optionalFloat(v)
		}
	}
	return nil
}

func (h *Handlers) loadRecipeNutrition(recipeID int) (calories, protein, carbs, fat *float64) {
	if recipeID <= 0 || !h.hasTable("recipes") {
		return nil, nil, nil, nil
	}
	var cal, pro, carb, f sql.NullFloat64
	err := h.DB.QueryRow(`SELECT calories, protein, carbs, fat FROM recipes WHERE id=?`, recipeID).Scan(&cal, &pro, &carb, &f)
	if err != nil {
		return nil, nil, nil, nil
	}
	if cal.Valid {
		calories = &cal.Float64
	}
	if pro.Valid {
		protein = &pro.Float64
	}
	if carb.Valid {
		carbs = &carb.Float64
	}
	if f.Valid {
		fat = &f.Float64
	}
	return calories, protein, carbs, fat
}

func nutritionFromPerServing(raw any, servings float64) (calories, protein, carbs, fat *float64) {
	m, ok := raw.(map[string]any)
	if !ok || m == nil {
		return nil, nil, nil, nil
	}
	return scaleNutrition(optionalFloat(m["calories"]), servings),
		scaleNutrition(optionalFloat(m["protein"]), servings),
		scaleNutrition(optionalFloat(m["carbs"]), servings),
		scaleNutrition(optionalFloat(m["fat"]), servings)
}

type dietInserter interface {
	InsertID(query string, args ...any) (int64, error)
}

func (h *Handlers) insertDietRecord(userID int, record map[string]any, defaultFood string) (map[string]any, error) {
	return h.insertDietRecordWith(h.DB, userID, record, defaultFood)
}

func (h *Handlers) insertDietRecordWith(db dietInserter, userID int, record map[string]any, defaultFood string) (map[string]any, error) {
	mealType := strings.TrimSpace(asString(record["meal_type"]))
	foodName := strings.TrimSpace(asString(record["food_name"]))
	if foodName == "" {
		foodName = defaultFood
	}
	amount := strings.TrimSpace(asString(record["amount"]))
	if amount == "" {
		amount = "1份"
	}
	recordedAt := strings.TrimSpace(asString(record["recorded_at"]))
	if recordedAt == "" {
		recordedAt = todayDateKey()
	}
	if len(recordedAt) > 10 {
		recordedAt = recordedAt[:10]
	}
	recordedTime := strings.TrimSpace(asString(record["recorded_time"]))
	imageURL := strings.TrimSpace(asString(record["image_url"]))

	calories := optionalNutritionField(record, "calories")
	protein := optionalNutritionField(record, "protein")
	carbs := optionalNutritionField(record, "carbs")
	fat := optionalNutritionField(record, "fat")
	idem := strings.TrimSpace(asString(record["idempotency_key"]))
	if idem == "" {
		idem = strings.TrimSpace(asString(record["idempotencyKey"]))
	}

	cols := []string{"user_id", "meal_type", "food_name", "calories", "recorded_at"}
	args := []any{userID, mealType, foodName, nullFloatArg(calories), recordedAt}
	if h.hasColumn("diet_records", "amount") {
		cols = append(cols, "amount")
		args = append(args, amount)
	}
	if h.hasColumn("diet_records", "idempotency_key") && idem != "" {
		cols = append(cols, "idempotency_key")
		args = append(args, idem)
	}
	if h.hasColumn("diet_records", "protein") {
		cols = append(cols, "protein")
		args = append(args, nullFloatArg(protein))
	}
	if h.hasColumn("diet_records", "carbs") {
		cols = append(cols, "carbs")
		args = append(args, nullFloatArg(carbs))
	}
	if h.hasColumn("diet_records", "fat") {
		cols = append(cols, "fat")
		args = append(args, nullFloatArg(fat))
	}
	if h.hasColumn("diet_records", "recorded_time") && recordedTime != "" {
		cols = append(cols, "recorded_time")
		args = append(args, recordedTime)
	}
	if h.hasColumn("diet_records", "image_url") && imageURL != "" {
		cols = append(cols, "image_url")
		args = append(args, imageURL)
	}

	placeholders := make([]string, len(cols))
	for i := range cols {
		placeholders[i] = "?"
	}
	id, err := db.InsertID(
		fmt.Sprintf(`INSERT INTO diet_records (%s) VALUES (%s)`, strings.Join(cols, ", "), strings.Join(placeholders, ", ")),
		args...,
	)
	if err != nil {
		return nil, err
	}
	return h.dietRecordResponse(int(id), mealType, foodName, amount, recordedAt, recordedTime, imageURL, calories, protein, carbs, fat), nil
}

func (h *Handlers) dietRecordResponse(
	id int, mealType, foodName, amount, recordedAt, recordedTime, imageURL string,
	calories, protein, carbs, fat *float64,
) map[string]any {
	out := map[string]any{
		"id": id, "meal_type": mealType, "food_name": foodName, "amount": amount, "recorded_at": recordedAt,
		"calories": nil, "protein": nil, "carbs": nil, "fat": nil, "image_url": nil, "recorded_time": nil,
	}
	if calories != nil {
		out["calories"] = *calories
	}
	if protein != nil {
		out["protein"] = *protein
	}
	if carbs != nil {
		out["carbs"] = *carbs
	}
	if fat != nil {
		out["fat"] = *fat
	}
	if recordedTime != "" {
		out["recorded_time"] = recordedTime
	}
	if imageURL != "" {
		out["image_url"] = imageURL
	}
	return out
}

func (h *Handlers) listDietRecords(userID int, dateKey string, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	selectCols := `id, COALESCE(meal_type,''), COALESCE(food_name,''), calories, COALESCE(recorded_at, created_at)`
	hasAmount := h.hasColumn("diet_records", "amount")
	hasProtein := h.hasColumn("diet_records", "protein")
	hasCarbs := h.hasColumn("diet_records", "carbs")
	hasFat := h.hasColumn("diet_records", "fat")
	hasTime := h.hasColumn("diet_records", "recorded_time")
	hasImage := h.hasColumn("diet_records", "image_url")
	if hasAmount {
		selectCols += `, COALESCE(amount,'')`
	}
	if hasProtein {
		selectCols += `, protein`
	}
	if hasCarbs {
		selectCols += `, carbs`
	}
	if hasFat {
		selectCols += `, fat`
	}
	if hasTime {
		selectCols += `, COALESCE(recorded_time,'')`
	}
	if hasImage {
		selectCols += `, COALESCE(image_url,'')`
	}

	query := `SELECT ` + selectCols + ` FROM diet_records WHERE user_id=?`
	args := []any{userID}
	dateKey = strings.TrimSpace(dateKey)
	if dateKey != "" {
		if len(dateKey) > 10 {
			dateKey = dateKey[:10]
		}
		query += ` AND substr(COALESCE(recorded_at, created_at), 1, 10)=?`
		args = append(args, dateKey)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := h.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var mealType, foodName, recorded string
		var calories sql.NullFloat64
		scanArgs := []any{&id, &mealType, &foodName, &calories, &recorded}
		var amount, recordedTime, imageURL string
		var protein, carbs, fat sql.NullFloat64
		if hasAmount {
			scanArgs = append(scanArgs, &amount)
		}
		if hasProtein {
			scanArgs = append(scanArgs, &protein)
		}
		if hasCarbs {
			scanArgs = append(scanArgs, &carbs)
		}
		if hasFat {
			scanArgs = append(scanArgs, &fat)
		}
		if hasTime {
			scanArgs = append(scanArgs, &recordedTime)
		}
		if hasImage {
			scanArgs = append(scanArgs, &imageURL)
		}
		if err := rows.Scan(scanArgs...); err != nil {
			continue
		}
		if len(recorded) > 10 {
			recorded = recorded[:10]
		}
		var calPtr, proPtr, carbPtr, fatPtr *float64
		if calories.Valid {
			calPtr = &calories.Float64
		}
		if protein.Valid {
			proPtr = &protein.Float64
		}
		if carbs.Valid {
			carbPtr = &carbs.Float64
		}
		if fat.Valid {
			fatPtr = &fat.Float64
		}
		list = append(list, h.dietRecordResponse(id, mealType, foodName, amount, recorded, recordedTime, imageURL, calPtr, proPtr, carbPtr, fatPtr))
	}
	return list, nil
}

func (h *Handlers) todayDietCalories(userID int) float64 {
	dateKey := todayDateKey()
	rows, err := h.listDietRecords(userID, dateKey, 500)
	if err != nil {
		return 0
	}
	var total float64
	for _, row := range rows {
		if v := optionalFloat(row["calories"]); v != nil {
			total += *v
		}
	}
	return total
}

func (h *Handlers) findDietByIdempotency(userID int, key string) (map[string]any, error) {
	key = strings.TrimSpace(key)
	if key == "" || !h.hasColumn("diet_records", "idempotency_key") {
		return nil, sql.ErrNoRows
	}
	var id int
	err := h.DB.QueryRow(`SELECT id FROM diet_records WHERE user_id=? AND idempotency_key=? ORDER BY id DESC LIMIT 1`, userID, key).Scan(&id)
	if err != nil {
		return nil, err
	}
	list, err := h.listDietRecords(userID, "", 50)
	if err != nil {
		return nil, err
	}
	for _, item := range list {
		if asInt(item["id"]) == id {
			return item, nil
		}
	}
	return map[string]any{"id": id}, nil
}
