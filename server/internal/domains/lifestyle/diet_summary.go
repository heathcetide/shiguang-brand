package lifestyle

import (
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
)

type dietDayBucket struct {
	Date           string   `json:"date"`
	Calories       *float64 `json:"calories"`
	Protein        *float64 `json:"protein"`
	Carbs          *float64 `json:"carbs"`
	Fat            *float64 `json:"fat"`
	RecordCount    int      `json:"recordCount"`
	IncompleteCal  bool     `json:"incompleteCalories"`
	IncompletePro  bool     `json:"incompleteProtein"`
	IncompleteCarb bool     `json:"incompleteCarbs"`
	IncompleteFat  bool     `json:"incompleteFat"`
}

type dietTargets struct {
	CaloriesKcal *float64 `json:"calories_kcal,omitempty"`
	ProteinG     *float64 `json:"protein_g,omitempty"`
	CarbsG       *float64 `json:"carbs_g,omitempty"`
	FatG         *float64 `json:"fat_g,omitempty"`
}

type dayAgg struct {
	cal, pro, carb, fat                         float64
	hasCal, hasPro, hasCarb, hasFat             bool
	count                                       int
	incompleteCal, incompletePro, incompleteCarb, incompleteFat bool
}

// DietNutritionSummary returns Shanghai-calendar daily diet aggregates vs profile targets.
func (h *Handlers) DietNutritionSummary(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if days != 30 {
		days = 7
	}
	if !h.hasTable("diet_records") {
		c.JSON(http.StatusOK, gin.H{
			"days": days, "timezone": "Asia/Shanghai", "targets": dietTargets{}, "daily": []dietDayBucket{},
			"totals": gin.H{"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "recordCount": 0, "loggedDays": 0},
			"adherence": gin.H{"calorieDaysMet": 0, "calorieDaysTracked": 0, "proteinDaysMet": 0, "proteinDaysTracked": 0},
		})
		return
	}

	loc := shanghaiLocation()
	today := time.Now().In(loc)
	start := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -(days - 1))
	startKey := start.Format("2006-01-02")
	endKey := today.Format("2006-01-02")

	hasProtein := h.hasColumn("diet_records", "protein")
	hasCarbs := h.hasColumn("diet_records", "carbs")
	hasFat := h.hasColumn("diet_records", "fat")

	selectSQL := `SELECT substr(COALESCE(recorded_at, created_at),1,10) AS day_key, calories`
	if hasProtein {
		selectSQL += `, protein`
	}
	if hasCarbs {
		selectSQL += `, carbs`
	}
	if hasFat {
		selectSQL += `, fat`
	}
	selectSQL += ` FROM diet_records WHERE user_id=? AND substr(COALESCE(recorded_at, created_at),1,10) BETWEEN ? AND ?`

	rows, err := h.DB.Query(selectSQL, userID, startKey, endKey)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"days": days, "timezone": "Asia/Shanghai", "targets": dietTargets{}, "daily": []dietDayBucket{}, "error": "query_failed"})
		return
	}
	defer rows.Close()

	byDay := map[string]*dayAgg{}

	for rows.Next() {
		var dayKey string
		var cal sql.NullFloat64
		var pro, carb, fat sql.NullFloat64
		scan := []any{&dayKey, &cal}
		if hasProtein {
			scan = append(scan, &pro)
		}
		if hasCarbs {
			scan = append(scan, &carb)
		}
		if hasFat {
			scan = append(scan, &fat)
		}
		if rows.Scan(scan...) != nil {
			continue
		}
		agg := byDay[dayKey]
		if agg == nil {
			agg = &dayAgg{}
			byDay[dayKey] = agg
		}
		agg.count++
		if cal.Valid {
			agg.cal += cal.Float64
			agg.hasCal = true
		} else {
			agg.incompleteCal = true
		}
		if hasProtein {
			if pro.Valid {
				agg.pro += pro.Float64
				agg.hasPro = true
			} else {
				agg.incompletePro = true
			}
		}
		if hasCarbs {
			if carb.Valid {
				agg.carb += carb.Float64
				agg.hasCarb = true
			} else {
				agg.incompleteCarb = true
			}
		}
		if hasFat {
			if fat.Valid {
				agg.fat += fat.Float64
				agg.hasFat = true
			} else {
				agg.incompleteFat = true
			}
		}
	}

	targets := h.loadDietTargets(userID)
	daily := make([]dietDayBucket, 0, days)
	var totalCal, totalPro, totalCarb, totalFat float64
	var totalRecords, loggedDays int
	var calMet, calTracked, proMet, proTracked int

	for i := 0; i < days; i++ {
		key := start.AddDate(0, 0, i).Format("2006-01-02")
		bucket := dietDayBucket{Date: key}
		if agg := byDay[key]; agg != nil {
			bucket.RecordCount = agg.count
			totalRecords += agg.count
			if agg.count > 0 {
				loggedDays++
			}
			bucket.IncompleteCal = agg.incompleteCal
			bucket.IncompletePro = agg.incompletePro
			bucket.IncompleteCarb = agg.incompleteCarb
			bucket.IncompleteFat = agg.incompleteFat
			if agg.hasCal {
				v := round1(agg.cal)
				bucket.Calories = &v
				totalCal += agg.cal
				if targets.CaloriesKcal != nil && !agg.incompleteCal {
					calTracked++
					if agg.cal <= *targets.CaloriesKcal*1.05 {
						calMet++
					}
				}
			}
			if agg.hasPro {
				v := round1(agg.pro)
				bucket.Protein = &v
				totalPro += agg.pro
				if targets.ProteinG != nil && !agg.incompletePro {
					proTracked++
					if agg.pro >= *targets.ProteinG*0.85 {
						proMet++
					}
				}
			}
			if agg.hasCarb {
				v := round1(agg.carb)
				bucket.Carbs = &v
				totalCarb += agg.carb
			}
			if agg.hasFat {
				v := round1(agg.fat)
				bucket.Fat = &v
				totalFat += agg.fat
			}
		}
		daily = append(daily, bucket)
	}

	c.JSON(http.StatusOK, gin.H{
		"days":      days,
		"timezone":  "Asia/Shanghai",
		"from":      startKey,
		"to":        endKey,
		"targets":   targets,
		"daily":     daily,
		"totals": gin.H{
			"calories":    round1(totalCal),
			"protein":     round1(totalPro),
			"carbs":       round1(totalCarb),
			"fat":         round1(totalFat),
			"recordCount": totalRecords,
			"loggedDays":  loggedDays,
		},
		"adherence": gin.H{
			"calorieDaysMet":      calMet,
			"calorieDaysTracked":  calTracked,
			"proteinDaysMet":      proMet,
			"proteinDaysTracked":  proTracked,
			"calorieAdherencePct": pctOrNil(calMet, calTracked),
			"proteinAdherencePct": pctOrNil(proMet, proTracked),
		},
		"today": gin.H{
			"date":             endKey,
			"remainingCalories": remainingOrNil(targets.CaloriesKcal, byDay[endKey]),
			"remainingProtein":  remainingProteinOrNil(targets.ProteinG, byDay[endKey]),
			"remainingCarbs":    remainingMacroOrNil(targets.CarbsG, byDay[endKey], "carb"),
			"remainingFat":      remainingMacroOrNil(targets.FatG, byDay[endKey], "fat"),
		},
	})
}

func (h *Handlers) loadDietTargets(userID int) dietTargets {
	out := dietTargets{}
	if !h.hasTable("user_health_profiles") {
		return out
	}
	var payload sql.NullString
	_ = h.DB.QueryRow(`SELECT COALESCE(profile_json,'') FROM user_health_profiles WHERE user_id=?`, userID).Scan(&payload)
	if !payload.Valid || strings.TrimSpace(payload.String) == "" {
		return out
	}
	var profile map[string]any
	if json.Unmarshal([]byte(payload.String), &profile) != nil || profile == nil {
		return out
	}
	if targets, ok := profile["nutrition_targets"].(map[string]any); ok {
		out.CaloriesKcal = optionalFloat(targets["calories_kcal"])
		out.ProteinG = optionalFloat(targets["protein_g"])
		out.CarbsG = optionalFloat(targets["carbs_g"])
		out.FatG = optionalFloat(targets["fat_g"])
	}
	if out.CaloriesKcal == nil {
		if calorieTarget, ok := profile["calorieTarget"].(map[string]any); ok {
			if v := optionalFloat(calorieTarget["value"]); v != nil {
				out.CaloriesKcal = v
			} else if v := optionalFloat(calorieTarget["referenceValue"]); v != nil {
				out.CaloriesKcal = v
			}
		}
	}
	return out
}

func shanghaiLocation() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.Local
	}
	return loc
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func pctOrNil(met, tracked int) any {
	if tracked <= 0 {
		return nil
	}
	return math.Round(1000*float64(met)/float64(tracked)) / 10
}

func remainingOrNil(target *float64, agg *dayAgg) any {
	if target == nil {
		return nil
	}
	used := 0.0
	if agg != nil && agg.hasCal {
		used = agg.cal
	}
	return round1(math.Max(0, *target-used))
}

func remainingProteinOrNil(target *float64, agg *dayAgg) any {
	if target == nil {
		return nil
	}
	used := 0.0
	if agg != nil && agg.hasPro {
		used = agg.pro
	}
	return round1(math.Max(0, *target-used))
}

func remainingMacroOrNil(target *float64, agg *dayAgg, kind string) any {
	if target == nil {
		return nil
	}
	used := 0.0
	if agg != nil {
		switch kind {
		case "carb":
			if agg.hasCarb {
				used = agg.carb
			}
		case "fat":
			if agg.hasFat {
				used = agg.fat
			}
		}
	}
	return round1(math.Max(0, *target-used))
}
