package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.UserProfile;
//import com.foodrecord.dto.NutritionDTO;
//import com.foodrecord.model.ActivityLevel;
//import com.foodrecord.model.Gender;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.Arrays;
//
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class NutritionCalculatorTest {
//
//    @InjectMocks
//    private NutritionCalculatorImpl calculator;
//
//    @Test
//    void shouldCalculateBasicNutrition() {
//        // Given
//        UserProfile profile = createBasicProfile();
//
//        // When
//        NutritionDTO nutrition = calculator.calculateNutrition(profile);
//
//        // Then
//        assertThat(nutrition.getDailyCalories()).isBetween(1800.0, 2500.0);
//        assertThat(nutrition.getProteinGrams()).isPositive();
//        assertThat(nutrition.getCarbGrams()).isPositive();
//        assertThat(nutrition.getFatGrams()).isPositive();
//    }
//
//    @Test
//    void shouldAdjustForWeightGoals() {
//        // Given
//        UserProfile profile = createProfileWithWeightLossGoal();
//
//        // When
//        NutritionDTO nutrition = calculator.calculateNutrition(profile);
//
//        // Then
//        assertThat(nutrition.getDailyCalories())
//            .isLessThan(calculator.calculateNutrition(createBasicProfile()).getDailyCalories());
//    }
//
//    @Test
//    void shouldAdjustForDietaryRestrictions() {
//        // Given
//        UserProfile profile = createProfileWithRestrictions();
//
//        // When
//        NutritionDTO nutrition = calculator.calculateNutrition(profile);
//
//        // Then
//        assertThat(nutrition.getProteinGrams())
//            .isGreaterThan(calculator.calculateNutrition(createBasicProfile()).getProteinGrams());
//    }
//
//    @Test
//    void shouldCalculateMacroRatios() {
//        // Given
//        UserProfile profile = createBasicProfile();
//
//        // When
//        NutritionDTO nutrition = calculator.calculateNutrition(profile);
//
//        // Then
//        double totalGrams = nutrition.getProteinGrams() + nutrition.getCarbGrams() + nutrition.getFatGrams();
//        assertThat(nutrition.getProteinGrams() / totalGrams).isBetween(0.2, 0.35);
//        assertThat(nutrition.getCarbGrams() / totalGrams).isBetween(0.45, 0.65);
//        assertThat(nutrition.getFatGrams() / totalGrams).isBetween(0.2, 0.35);
//    }
//
//    @Test
//    void shouldCalculateBMRForMale() {
//        // Given
//        UserProfile profile = createMaleProfile();
//
//        // When
//        double bmr = calculator.calculateBMR(profile);
//
//        // Then
//        assertThat(bmr).isCloseTo(1800.0, within(100.0));
//    }
//
//    @Test
//    void shouldCalculateBMRForFemale() {
//        // Given
//        UserProfile profile = createFemaleProfile();
//
//        // When
//        double bmr = calculator.calculateBMR(profile);
//
//        // Then
//        assertThat(bmr).isCloseTo(1500.0, within(100.0));
//    }
//
//    @Test
//    void shouldCalculateTDEEForSedentary() {
//        // Given
//        UserProfile profile = createProfileWithActivity(ActivityLevel.SEDENTARY);
//
//        // When
//        double tdee = calculator.calculateTDEE(profile);
//
//        // Then
//        assertThat(tdee).isCloseTo(2000.0, within(100.0));
//    }
//
//    @Test
//    void shouldCalculateTDEEForActive() {
//        // Given
//        UserProfile profile = createProfileWithActivity(ActivityLevel.ACTIVE);
//
//        // When
//        double tdee = calculator.calculateTDEE(profile);
//
//        // Then
//        assertThat(tdee).isGreaterThan(2500.0);
//    }
//
//    @Test
//    void shouldCalculateMacronutrients() {
//        // Given
//        double calories = 2000.0;
//
//        // When
//        MacronutrientRatio ratio = calculator.calculateMacronutrients(calories);
//
//        // Then
//        assertThat(ratio.getProteinGrams()).isCloseTo(125.0, within(5.0));
//        assertThat(ratio.getCarbGrams()).isCloseTo(250.0, within(5.0));
//        assertThat(ratio.getFatGrams()).isCloseTo(67.0, within(5.0));
//    }
//
//    private UserProfile createBasicProfile() {
//        return UserProfile.builder()
//            .height(175.0)
//            .weight(70.0)
//            .age(30)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//
//    private UserProfile createProfileWithWeightLossGoal() {
//        return UserProfile.builder()
//            .height(175.0)
//            .weight(80.0)
//            .age(30)
//            .activityLevel(ActivityLevel.MODERATE)
//            .weightGoal(WeightGoal.LOSS)
//            .build();
//    }
//
//    private UserProfile createProfileWithRestrictions() {
//        return UserProfile.builder()
//            .height(175.0)
//            .weight(70.0)
//            .age(30)
//            .activityLevel(ActivityLevel.MODERATE)
//            .dietaryRestrictions(Arrays.asList("vegetarian"))
//            .build();
//    }
//
//    private UserProfile createMaleProfile() {
//        return UserProfile.builder()
//            .gender(Gender.MALE)
//            .age(30)
//            .weight(75.0)
//            .height(180.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//
//    private UserProfile createFemaleProfile() {
//        return UserProfile.builder()
//            .gender(Gender.FEMALE)
//            .age(30)
//            .weight(60.0)
//            .height(165.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//
//    private UserProfile createProfileWithActivity(ActivityLevel level) {
//        return UserProfile.builder()
//            .gender(Gender.MALE)
//            .age(30)
//            .weight(75.0)
//            .height(180.0)
//            .activityLevel(level)
//            .build();
//    }
//}