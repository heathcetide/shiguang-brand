package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.NutritionDTO;
//import com.foodrecord.model.UserProfile;
//import com.foodrecord.repository.UserProfileRepository;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.Optional;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class NutritionServiceTest {
//
//    @Mock
//    private UserProfileRepository profileRepository;
//
//    @Mock
//    private NutritionCalculator nutritionCalculator;
//
//    @Mock
//    private DietaryRestrictionValidator restrictionValidator;
//
//    @InjectMocks
//    private NutritionServiceImpl nutritionService;
//
//    @Test
//    void shouldCalculateUserNutrition() {
//        // Given
//        Long userId = 1L;
//        UserProfile profile = createUserProfile();
//        NutritionDTO expectedNutrition = createNutritionDTO();
//
//        when(profileRepository.findByUserId(userId)).thenReturn(Optional.of(profile));
//        when(nutritionCalculator.calculateNutrition(profile)).thenReturn(expectedNutrition);
//
//        // When
//        NutritionDTO result = nutritionService.calculateUserNutrition(userId);
//
//        // Then
//        assertThat(result).isNotNull();
//        assertThat(result.getDailyCalories()).isEqualTo(expectedNutrition.getDailyCalories());
//        verify(nutritionCalculator).calculateNutrition(profile);
//    }
//
//    @Test
//    void shouldValidateDietaryRestrictions() {
//        // Given
//        UserProfile profile = createUserProfile();
//        when(restrictionValidator.validate(profile.getDietaryRestrictions())).thenReturn(true);
//
//        // When
//        boolean isValid = nutritionService.validateDietaryRestrictions(profile);
//
//        // Then
//        assertThat(isValid).isTrue();
//        verify(restrictionValidator).validate(profile.getDietaryRestrictions());
//    }
//
//    @Test
//    void shouldAdjustForActivity() {
//        // Given
//        UserProfile profile = createActiveProfile();
//        NutritionDTO baseNutrition = createNutritionDTO();
//        NutritionDTO adjustedNutrition = createAdjustedNutritionDTO();
//
//        when(nutritionCalculator.calculateNutrition(profile)).thenReturn(baseNutrition);
//        when(nutritionCalculator.adjustForActivity(baseNutrition, profile.getActivityLevel()))
//            .thenReturn(adjustedNutrition);
//
//        // When
//        NutritionDTO result = nutritionService.calculateUserNutrition(profile.getUserId());
//
//        // Then
//        assertThat(result.getDailyCalories()).isGreaterThan(baseNutrition.getDailyCalories());
//    }
//
//    @Test
//    void shouldHandleUserNotFound() {
//        // Given
//        Long userId = 999L;
//        when(profileRepository.findByUserId(userId)).thenReturn(Optional.empty());
//
//        // When & Then
//        assertThatThrownBy(() -> nutritionService.calculateUserNutrition(userId))
//            .isInstanceOf(UserNotFoundException.class);
//    }
//
//    private UserProfile createUserProfile() {
//        return UserProfile.builder()
//            .userId(1L)
//            .height(175.0)
//            .weight(70.0)
//            .age(30)
//            .activityLevel(ActivityLevel.MODERATE)
//            .dietaryRestrictions(Arrays.asList("vegetarian"))
//            .build();
//    }
//
//    private UserProfile createActiveProfile() {
//        return UserProfile.builder()
//            .userId(2L)
//            .height(180.0)
//            .weight(75.0)
//            .age(25)
//            .activityLevel(ActivityLevel.HIGH)
//            .build();
//    }
//
//    private NutritionDTO createNutritionDTO() {
//        return NutritionDTO.builder()
//            .dailyCalories(2000)
//            .proteinGrams(150)
//            .carbGrams(250)
//            .fatGrams(67)
//            .build();
//    }
//
//    private NutritionDTO createAdjustedNutritionDTO() {
//        return NutritionDTO.builder()
//            .dailyCalories(2500)
//            .proteinGrams(187)
//            .carbGrams(313)
//            .fatGrams(83)
//            .build();
//    }
//}