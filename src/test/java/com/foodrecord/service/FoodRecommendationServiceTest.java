package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.repository.UserPreferenceRepository;
//import com.foodrecord.model.UserPreference;
//import com.foodrecord.model.FoodRecommendation;
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
//class FoodRecommendationServiceTest {
//
//    @Mock
//    private UserPreferenceRepository preferenceRepository;
//
//    @Mock
//    private NutritionAnalyzer nutritionAnalyzer;
//
//    @Mock
//    private MachineLearningRecommender mlRecommender;
//
//    @InjectMocks
//    private FoodRecommendationServiceImpl recommendationService;
//
//    @Test
//    void shouldGeneratePersonalizedRecommendations() {
//        // Given
//        Long userId = 1L;
//        UserPreference preference = createUserPreference(userId);
//        NutritionGoals goals = createNutritionGoals();
//
//        when(preferenceRepository.findByUserId(userId))
//            .thenReturn(Optional.of(preference));
//        when(nutritionAnalyzer.analyzeNutritionalNeeds(any()))
//            .thenReturn(goals);
//        when(mlRecommender.recommendFoods(any(), any()))
//            .thenReturn(createRecommendations());
//
//        // When
//        List<FoodRecommendation> recommendations =
//            recommendationService.getPersonalizedRecommendations(userId);
//
//        // Then
//        assertThat(recommendations).hasSize(3);
//        assertThat(recommendations.get(0).getConfidenceScore()).isGreaterThan(0.8);
//        verify(mlRecommender).recommendFoods(any(), any());
//    }
//
//    @Test
//    void shouldConsiderDietaryRestrictions() {
//        // Given
//        Long userId = 1L;
//        UserPreference preference = createUserPreference(userId);
//        preference.setDietaryRestrictions(Arrays.asList("vegetarian", "gluten-free"));
//
//        when(preferenceRepository.findByUserId(userId))
//            .thenReturn(Optional.of(preference));
//        when(mlRecommender.recommendFoods(any(), any()))
//            .thenReturn(createRecommendations());
//
//        // When
//        List<FoodRecommendation> recommendations =
//            recommendationService.getPersonalizedRecommendations(userId);
//
//        // Then
//        assertThat(recommendations).allMatch(rec ->
//            rec.isVegetarian() && rec.isGlutenFree());
//    }
//
//    @Test
//    void shouldAdjustRecommendationsBasedOnTimeOfDay() {
//        // Given
//        Long userId = 1L;
//        LocalTime currentTime = LocalTime.of(8, 0); // Morning
//        UserPreference preference = createUserPreference(userId);
//
//        when(preferenceRepository.findByUserId(userId))
//            .thenReturn(Optional.of(preference));
//        when(mlRecommender.recommendFoods(any(), any()))
//            .thenReturn(createRecommendations());
//
//        // When
//        List<FoodRecommendation> recommendations =
//            recommendationService.getRecommendationsForTime(userId, currentTime);
//
//        // Then
//        assertThat(recommendations).allMatch(rec ->
//            rec.getMealType() == MealType.BREAKFAST);
//    }
//
//    @Test
//    void shouldHandleUserWithoutPreferences() {
//        // Given
//        Long userId = 1L;
//        when(preferenceRepository.findByUserId(userId))
//            .thenReturn(Optional.empty());
//        when(mlRecommender.recommendFoods(any(), any()))
//            .thenReturn(createDefaultRecommendations());
//
//        // When
//        List<FoodRecommendation> recommendations =
//            recommendationService.getPersonalizedRecommendations(userId);
//
//        // Then
//        assertThat(recommendations).isNotEmpty();
//        verify(mlRecommender).recommendFoods(any(),
//            argThat(prefs -> prefs.isUsingDefaultSettings()));
//    }
//
//    private UserPreference createUserPreference(Long userId) {
//        return UserPreference.builder()
//            .userId(userId)
//            .calorieGoal(2000)
//            .preferredMealTimes(Map.of(
//                MealType.BREAKFAST, "08:00",
//                MealType.LUNCH, "12:00",
//                MealType.DINNER, "19:00"
//            ))
//            .dietaryRestrictions(new ArrayList<>())
//            .build();
//    }
//
//    private NutritionGoals createNutritionGoals() {
//        return NutritionGoals.builder()
//            .dailyCalories(2000)
//            .proteinGrams(150)
//            .carbGrams(250)
//            .fatGrams(67)
//            .build();
//    }
//
//    private List<FoodRecommendation> createRecommendations() {
//        return Arrays.asList(
//            createRecommendation("Oatmeal", 0.95, MealType.BREAKFAST),
//            createRecommendation("Grilled Chicken Salad", 0.88, MealType.LUNCH),
//            createRecommendation("Salmon with Vegetables", 0.85, MealType.DINNER)
//        );
//    }
//
//    private FoodRecommendation createRecommendation(
//            String name, double confidence, MealType mealType) {
//        return FoodRecommendation.builder()
//            .foodName(name)
//            .confidenceScore(confidence)
//            .mealType(mealType)
//            .isVegetarian(name.contains("Salad"))
//            .isGlutenFree(true)
//            .nutritionInfo(createBasicNutritionInfo())
//            .build();
//    }
//
//    private NutritionInfo createBasicNutritionInfo() {
//        return NutritionInfo.builder()
//            .calories(300)
//            .protein(20)
//            .carbohydrates(40)
//            .fat(10)
//            .build();
//    }
//}