package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.PreferenceUpdateDTO;
//import com.foodrecord.model.ValidationResult;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.Arrays;
//import java.util.Map;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class PreferenceValidatorTest {
//
//    @Mock
//    private DietaryRestrictionValidator dietaryValidator;
//
//    @InjectMocks
//    private PreferenceValidatorImpl preferenceValidator;
//
//    @Test
//    void shouldValidateValidPreferences() {
//        // Given
//        PreferenceUpdateDTO dto = createValidPreferenceDTO();
//
//        when(dietaryValidator.validateRestrictions(any())).thenReturn(true);
//
//        // When
//        ValidationResult result = preferenceValidator.validate(dto);
//
//        // Then
//        assertThat(result.isValid()).isTrue();
//        assertThat(result.getErrors()).isEmpty();
//    }
//
//    @Test
//    void shouldDetectInvalidCalorieGoal() {
//        // Given
//        PreferenceUpdateDTO dto = createPreferenceDTO(-100);
//
//        // When
//        ValidationResult result = preferenceValidator.validate(dto);
//
//        // Then
//        assertThat(result.isValid()).isFalse();
//        assertThat(result.getErrors())
//            .contains("Calorie goal must be positive");
//    }
//
//    @Test
//    void shouldValidateMealTimes() {
//        // Given
//        PreferenceUpdateDTO dto = createPreferenceWithInvalidMealTimes();
//
//        // When
//        ValidationResult result = preferenceValidator.validate(dto);
//
//        // Then
//        assertThat(result.isValid()).isFalse();
//        assertThat(result.getErrors())
//            .contains("Invalid meal time format");
//    }
//
//    @Test
//    void shouldValidateDietaryRestrictions() {
//        // Given
//        PreferenceUpdateDTO dto = createValidPreferenceDTO();
//        when(dietaryValidator.validateRestrictions(any())).thenReturn(false);
//        when(dietaryValidator.getErrors()).thenReturn(
//            Arrays.asList("Invalid dietary restriction")
//        );
//
//        // When
//        ValidationResult result = preferenceValidator.validate(dto);
//
//        // Then
//        assertThat(result.isValid()).isFalse();
//        assertThat(result.getErrors())
//            .contains("Invalid dietary restriction");
//    }
//
//    @Test
//    void shouldHandleEmptyPreferences() {
//        // Given
//        PreferenceUpdateDTO emptyDTO = new PreferenceUpdateDTO();
//
//        // When
//        ValidationResult result = preferenceValidator.validate(emptyDTO);
//
//        // Then
//        assertThat(result.isValid()).isFalse();
//        assertThat(result.getErrors())
//            .contains("Calorie goal is required");
//    }
//
//    private PreferenceUpdateDTO createValidPreferenceDTO() {
//        return PreferenceUpdateDTO.builder()
//            .calorieGoal(2000)
//            .dietaryRestrictions(Arrays.asList("vegetarian"))
//            .mealReminders(true)
//            .preferredMealTimes(Map.of(
//                "breakfast", "08:00",
//                "lunch", "12:00",
//                "dinner", "19:00"
//            ))
//            .build();
//    }
//
//    private PreferenceUpdateDTO createPreferenceDTO(int calorieGoal) {
//        return PreferenceUpdateDTO.builder()
//            .calorieGoal(calorieGoal)
//            .dietaryRestrictions(Arrays.asList("vegetarian"))
//            .mealReminders(true)
//            .build();
//    }
//
//    private PreferenceUpdateDTO createPreferenceWithInvalidMealTimes() {
//        return PreferenceUpdateDTO.builder()
//            .calorieGoal(2000)
//            .preferredMealTimes(Map.of(
//                "breakfast", "invalid time",
//                "lunch", "25:00"
//            ))
//            .build();
//    }
//}