package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.NutritionAdvice;
//import com.foodrecord.model.UserProfile;
//import com.foodrecord.model.DailyNutrition;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.Arrays;
//import java.util.List;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class NutritionAdviceServiceTest {
//
//    @Mock
//    private NutritionCalculator nutritionCalculator;
//
//    @Mock
//    private FoodRecommender foodRecommender;
//
//    @InjectMocks
//    private NutritionAdviceServiceImpl adviceService;
//
//    @Test
//    void shouldGenerateAdviceForLowProtein() {
//        // Given
//        UserProfile profile = createUserProfile();
//        DailyNutrition nutrition = createLowProteinNutrition();
//
//        when(nutritionCalculator.calculateProteinNeeds(any()))
//            .thenReturn(150.0);
//        when(foodRecommender.getHighProteinFoods())
//            .thenReturn(Arrays.asList("chicken", "eggs", "fish"));
//
//        // When
//        NutritionAdvice advice = adviceService.generateAdvice(profile, nutrition);
//
//        // Then
//        assertThat(advice.getRecommendation())
//            .contains("increase protein intake");
//        assertThat(advice.getRecommendedFoods())
//            .containsAnyOf("chicken", "eggs", "fish");
//        assertThat(advice.getPriority()).isEqualTo(Priority.HIGH);
//    }
//
//    @Test
//    void shouldGenerateAdviceForHighCalories() {
//        // Given
//        UserProfile profile = createUserProfile();
//        DailyNutrition nutrition = createHighCalorieNutrition();
//
//        when(nutritionCalculator.calculateCalorieNeeds(any()))
//            .thenReturn(2000.0);
//        when(foodRecommender.getLowCalorieFoods())
//            .thenReturn(Arrays.asList("salad", "vegetables", "fruits"));
//
//        // When
//        NutritionAdvice advice = adviceService.generateAdvice(profile, nutrition);
//
//        // Then
//        assertThat(advice.getRecommendation())
//            .contains("reduce calorie intake");
//        assertThat(advice.getRecommendedFoods())
//            .containsAnyOf("salad", "vegetables");
//    }
//
//    @Test
//    void shouldConsiderDietaryRestrictions() {
//        // Given
//        UserProfile profile = createVegetarianProfile();
//        DailyNutrition nutrition = createLowProteinNutrition();
//
//        when(nutritionCalculator.calculateProteinNeeds(any()))
//            .thenReturn(150.0);
//        when(foodRecommender.getVegetarianProteinFoods())
//            .thenReturn(Arrays.asList("tofu", "lentils", "quinoa"));
//
//        // When
//        NutritionAdvice advice = adviceService.generateAdvice(profile, nutrition);
//
//        // Then
//        assertThat(advice.getRecommendedFoods())
//            .containsOnly("tofu", "lentils", "quinoa");
//        assertThat(advice.isVegetarianFriendly()).isTrue();
//    }
//
//    @Test
//    void shouldGenerateBalancedDietAdvice() {
//        // Given
//        UserProfile profile = createUserProfile();
//        DailyNutrition nutrition = createBalancedNutrition();
//
//        when(nutritionCalculator.calculateNutrientBalance(any()))
//            .thenReturn(0.9);
//
//        // When
//        NutritionAdvice advice = adviceService.generateAdvice(profile, nutrition);
//
//        // Then
//        assertThat(advice.getRecommendation())
//            .contains("maintain balanced diet");
//        assertThat(advice.getPriority()).isEqualTo(Priority.LOW);
//    }
//
//    private UserProfile createUserProfile() {
//        return UserProfile.builder()
//            .height(175.0)
//            .weight(70.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//
//    private UserProfile createVegetarianProfile() {
//        return UserProfile.builder()
//            .height(170.0)
//            .weight(65.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .dietaryRestrictions(Arrays.asList("vegetarian"))
//            .build();
//    }
//
//    private DailyNutrition createLowProteinNutrition() {
//        return DailyNutrition.builder()
//            .totalCalories(2000)
//            .totalProtein(40)
//            .totalCarbs(300)
//            .totalFat(70)
//            .build();
//    }
//
//    private DailyNutrition createHighCalorieNutrition() {
//        return DailyNutrition.builder()
//            .totalCalories(3000)
//            .totalProtein(120)
//            .totalCarbs(400)
//            .totalFat(100)
//            .build();
//    }
//
//    private DailyNutrition createBalancedNutrition() {
//        return DailyNutrition.builder()
//            .totalCalories(2200)
//            .totalProtein(110)
//            .totalCarbs(275)
//            .totalFat(73)
//            .build();
//    }
//}