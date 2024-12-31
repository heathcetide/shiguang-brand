package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.UserProfile;
//import com.foodrecord.model.ActivityLevel;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.junit.jupiter.MockitoExtension;
//
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class ActivityLevelCalculatorTest {
//
//    @InjectMocks
//    private ActivityLevelCalculatorImpl calculator;
//
//    @Test
//    void shouldCalculateForSedentaryLevel() {
//        // Given
//        UserProfile profile = createUserProfile(ActivityLevel.SEDENTARY);
//
//        // When
//        double multiplier = calculator.calculateCalorieMultiplier(profile);
//
//        // Then
//        assertThat(multiplier).isEqualTo(1.2);
//    }
//
//    @Test
//    void shouldCalculateForModerateLevel() {
//        // Given
//        UserProfile profile = createUserProfile(ActivityLevel.MODERATE);
//
//        // When
//        double multiplier = calculator.calculateCalorieMultiplier(profile);
//
//        // Then
//        assertThat(multiplier).isEqualTo(1.55);
//    }
//
//    @Test
//    void shouldCalculateForActiveLevel() {
//        // Given
//        UserProfile profile = createUserProfile(ActivityLevel.ACTIVE);
//
//        // When
//        double multiplier = calculator.calculateCalorieMultiplier(profile);
//
//        // Then
//        assertThat(multiplier).isEqualTo(1.725);
//    }
//
//    @Test
//    void shouldAdjustForAge() {
//        // Given
//        UserProfile profile = createUserProfileWithAge(45);
//
//        // When
//        double multiplier = calculator.calculateCalorieMultiplier(profile);
//
//        // Then
//        assertThat(multiplier).isLessThan(1.725);
//    }
//
//    @Test
//    void shouldCalculateBasalMetabolicRate() {
//        // Given
//        UserProfile profile = createUserProfile(ActivityLevel.MODERATE);
//
//        // When
//        double bmr = calculator.calculateBMR(profile);
//
//        // Then
//        assertThat(bmr).isPositive();
//        assertThat(bmr).isBetween(1200.0, 2500.0);
//    }
//
//    private UserProfile createUserProfile(ActivityLevel level) {
//        return UserProfile.builder()
//            .height(175.0)
//            .weight(70.0)
//            .age(30)
//            .activityLevel(level)
//            .build();
//    }
//
//    private UserProfile createUserProfileWithAge(int age) {
//        return UserProfile.builder()
//            .height(175.0)
//            .weight(70.0)
//            .age(age)
//            .activityLevel(ActivityLevel.ACTIVE)
//            .build();
//    }
//}