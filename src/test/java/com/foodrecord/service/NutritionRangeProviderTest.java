package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.NutritionRange;
//import com.foodrecord.model.UserProfile;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//
//import static org.assertj.core.api.Assertions.*;
//import static org.mockito.Mockito.*;
//
//@ExtendWith(MockitoExtension.class)
//class NutritionRangeProviderTest {
//
//    @Mock
//    private ActivityLevelCalculator activityCalculator;
//
//    @InjectMocks
//    private NutritionRangeProviderImpl rangeProvider;
//
//    @Test
//    void shouldCalculateRangeForActiveUser() {
//        // Given
//        UserProfile profile = createActiveUserProfile();
//        when(activityCalculator.calculateCalorieMultiplier(any()))
//            .thenReturn(1.5);
//
//        // When
//        NutritionRange range = rangeProvider.calculateRange(profile);
//
//        // Then
//        assertThat(range.getMinCalories()).isGreaterThan(2000);
//        assertThat(range.getMaxCalories()).isLessThan(3500);
//        assertThat(range.getMinProtein()).isGreaterThan(100);
//    }
//
//    @Test
//    void shouldCalculateRangeForSedentaryUser() {
//        // Given
//        UserProfile profile = createSedentaryUserProfile();
//        when(activityCalculator.calculateCalorieMultiplier(any()))
//            .thenReturn(1.2);
//
//        // When
//        NutritionRange range = rangeProvider.calculateRange(profile);
//
//        // Then
//        assertThat(range.getMinCalories()).isLessThan(2000);
//        assertThat(range.getMaxProtein()).isLessThan(150);
//    }
//
//    @Test
//    void shouldAdjustRangeForWeightGoals() {
//        // Given
//        UserProfile profile = createWeightLossProfile();
//
//        // When
//        NutritionRange range = rangeProvider.calculateRange(profile);
//
//        // Then
//        assertThat(range.getMaxCalories())
//            .isLessThan(rangeProvider.calculateRange(createActiveUserProfile())
//                .getMaxCalories());
//    }
//
//    @Test
//    void shouldProvideDefaultRanges() {
//        // When
//        NutritionRange range = rangeProvider.getDefaultRange();
//
//        // Then
//        assertThat(range.getMinCalories()).isPositive();
//        assertThat(range.getMaxCalories()).isGreaterThan(range.getMinCalories());
//        assertThat(range.getMinProtein()).isPositive();
//        assertThat(range.getMaxProtein()).isGreaterThan(range.getMinProtein());
//    }
//
//    @Test
//    void shouldValidateRanges() {
//        // Given
//        NutritionRange range = rangeProvider.calculateRange(createActiveUserProfile());
//
//        // When & Then
//        assertThat(range.getMaxCalories()).isGreaterThan(range.getMinCalories());
//        assertThat(range.getMaxProtein()).isGreaterThan(range.getMinProtein());
//        assertThat(range.getMaxCarbs()).isGreaterThan(range.getMinCarbs());
//        assertThat(range.getMaxFat()).isGreaterThan(range.getMinFat());
//    }
//
//    private UserProfile createActiveUserProfile() {
//        return UserProfile.builder()
//            .height(175.0)
//            .weight(70.0)
//            .activityLevel(ActivityLevel.HIGH)
//            .build();
//    }
//
//    private UserProfile createSedentaryUserProfile() {
//        return UserProfile.builder()
//            .height(170.0)
//            .weight(65.0)
//            .activityLevel(ActivityLevel.LOW)
//            .build();
//    }
//
//    private UserProfile createWeightLossProfile() {
//        return UserProfile.builder()
//            .height(175.0)
//            .weight(80.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .weightGoal(WeightGoal.LOSS)
//            .build();
//    }
//}