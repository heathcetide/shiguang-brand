package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.FoodItem;
//import com.foodrecord.model.NutritionPreference;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.List;
//import java.util.Arrays;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class FoodRecommenderTest {
//
//    @Mock
//    private FoodDatabase foodDatabase;
//
//    @Mock
//    private NutritionScorer nutritionScorer;
//
//    @InjectMocks
//    private FoodRecommenderImpl recommender;
//
//    @Test
//    void shouldRecommendHighProteinFoods() {
//        // Given
//        when(foodDatabase.getHighProteinFoods())
//            .thenReturn(Arrays.asList(
//                createFoodItem("Chicken Breast", 31.0),
//                createFoodItem("Greek Yogurt", 10.0),
//                createFoodItem("Eggs", 13.0)
//            ));
//
//        // When
//        List<FoodItem> recommendations = recommender.getHighProteinFoods();
//
//        // Then
//        assertThat(recommendations).hasSize(3);
//        assertThat(recommendations.get(0).getProteinContent()).isGreaterThan(30.0);
//    }
//
//    @Test
//    void shouldRecommendLowCalorieFoods() {
//        // Given
//        when(foodDatabase.getLowCalorieFoods())
//            .thenReturn(Arrays.asList(
//                createFoodItem("Lettuce", 15),
//                createFoodItem("Cucumber", 8),
//                createFoodItem("Spinach", 23)
//            ));
//
//        // When
//        List<FoodItem> recommendations = recommender.getLowCalorieFoods();
//
//        // Then
//        assertThat(recommendations).hasSize(3);
//        assertThat(recommendations).allMatch(food -> food.getCalories() < 50);
//    }
//
//    @Test
//    void shouldConsiderUserPreferences() {
//        // Given
//        NutritionPreference preferences = createPreferences();
//        List<FoodItem> foods = Arrays.asList(
//            createFoodItem("Quinoa", 120),
//            createFoodItem("Sweet Potato", 90),
//            createFoodItem("Brown Rice", 110)
//        );
//
//        when(foodDatabase.getHealthyCarbs()).thenReturn(foods);
//        when(nutritionScorer.scoreFood(any(), eq(preferences)))
//            .thenReturn(8.5, 7.0, 6.5);
//
//        // When
//        List<FoodItem> recommendations =
//            recommender.getRecommendations(preferences);
//
//        // Then
//        assertThat(recommendations).hasSize(3);
//        assertThat(recommendations.get(0).getName()).isEqualTo("Quinoa");
//    }
//
//    @Test
//    void shouldFilterAllergies() {
//        // Given
//        NutritionPreference preferences = createPreferencesWithAllergies();
//        when(foodDatabase.getAllFoods()).thenReturn(Arrays.asList(
//            createFoodItem("Peanut Butter", 190),
//            createFoodItem("Almond Milk", 30),
//            createFoodItem("Banana", 105)
//        ));
//
//        // When
//        List<FoodItem> recommendations =
//            recommender.getRecommendations(preferences);
//
//        // Then
//        assertThat(recommendations)
//            .noneMatch(food -> food.getName().contains("Peanut"));
//    }
//
//    private FoodItem createFoodItem(String name, double calories) {
//        return FoodItem.builder()
//            .name(name)
//            .calories(calories)
//            .proteinContent(name.equals("Chicken Breast") ? 31.0 :
//                          name.equals("Greek Yogurt") ? 10.0 : 5.0)
//            .build();
//    }
//
//    private NutritionPreference createPreferences() {
//        return NutritionPreference.builder()
//            .calorieTarget(2000)
//            .proteinPreference(HIGH)
//            .carbPreference(MODERATE)
//            .fatPreference(LOW)
//            .build();
//    }
//
//    private NutritionPreference createPreferencesWithAllergies() {
//        return NutritionPreference.builder()
//            .calorieTarget(2000)
//            .allergies(Arrays.asList("peanuts", "shellfish"))
//            .build();
//    }
//}