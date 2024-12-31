package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.FoodItem;
//import com.foodrecord.model.NutritionPreference;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.junit.jupiter.MockitoExtension;
//
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class NutritionScorerTest {
//
//    @InjectMocks
//    private NutritionScorerImpl nutritionScorer;
//
//    @Test
//    void shouldScoreHighProteinFood() {
//        // Given
//        FoodItem food = createFoodItem("Chicken Breast", 165, 31.0, 0.0, 3.6);
//        NutritionPreference preferences = createHighProteinPreference();
//
//        // When
//        double score = nutritionScorer.scoreFood(food, preferences);
//
//        // Then
//        assertThat(score).isGreaterThan(8.0);
//    }
//
//    @Test
//    void shouldScoreLowCalorieFood() {
//        // Given
//        FoodItem food = createFoodItem("Salad", 50, 2.0, 10.0, 0.5);
//        NutritionPreference preferences = createLowCaloriePreference();
//
//        // When
//        double score = nutritionScorer.scoreFood(food, preferences);
//
//        // Then
//        assertThat(score).isGreaterThan(7.0);
//    }
//
//    @Test
//    void shouldPenalizeUnhealthyFood() {
//        // Given
//        FoodItem food = createFoodItem("Cake", 350, 4.0, 50.0, 18.0);
//        NutritionPreference preferences = createHealthyPreference();
//
//        // When
//        double score = nutritionScorer.scoreFood(food, preferences);
//
//        // Then
//        assertThat(score).isLessThan(5.0);
//    }
//
//    @Test
//    void shouldConsiderMacronutrientBalance() {
//        // Given
//        FoodItem food = createFoodItem("Quinoa", 120, 4.4, 21.3, 1.9);
//        NutritionPreference preferences = createBalancedPreference();
//
//        // When
//        double score = nutritionScorer.scoreFood(food, preferences);
//
//        // Then
//        assertThat(score).isBetween(6.0, 8.0);
//    }
//
//    @Test
//    void shouldHandleExtremeMacronutrients() {
//        // Given
//        FoodItem food = createFoodItem("Oil", 900, 0.0, 0.0, 100.0);
//        NutritionPreference preferences = createBalancedPreference();
//
//        // When
//        double score = nutritionScorer.scoreFood(food, preferences);
//
//        // Then
//        assertThat(score).isLessThan(3.0);
//    }
//
//    private FoodItem createFoodItem(String name, int calories,
//            double protein, double carbs, double fat) {
//        return FoodItem.builder()
//            .name(name)
//            .calories(calories)
//            .proteinContent(protein)
//            .carbContent(carbs)
//            .fatContent(fat)
//            .build();
//    }
//
//    private NutritionPreference createHighProteinPreference() {
//        return NutritionPreference.builder()
//            .calorieTarget(2000)
//            .proteinPreference(HIGH)
//            .carbPreference(MODERATE)
//            .fatPreference(LOW)
//            .build();
//    }
//
//    private NutritionPreference createLowCaloriePreference() {
//        return NutritionPreference.builder()
//            .calorieTarget(1500)
//            .proteinPreference(MODERATE)
//            .carbPreference(MODERATE)
//            .fatPreference(LOW)
//            .build();
//    }
//
//    private NutritionPreference createHealthyPreference() {
//        return NutritionPreference.builder()
//            .calorieTarget(2000)
//            .healthFocus(true)
//            .sugarRestriction(true)
//            .build();
//    }
//
//    private NutritionPreference createBalancedPreference() {
//        return NutritionPreference.builder()
//            .calorieTarget(2000)
//            .proteinPreference(MODERATE)
//            .carbPreference(MODERATE)
//            .fatPreference(MODERATE)
//            .build();
//    }
//}