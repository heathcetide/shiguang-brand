package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.repository.UserPreferenceRepository;
//import com.foodrecord.model.UserPreference;
//import com.foodrecord.dto.PreferenceUpdateDTO;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.Arrays;
//import java.util.Optional;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class UserPreferenceServiceTest {
//
//    @Mock
//    private UserPreferenceRepository preferenceRepository;
//
//    @Mock
//    private PreferenceValidator preferenceValidator;
//
//    @InjectMocks
//    private UserPreferenceServiceImpl preferenceService;
//
//    @Test
//    void shouldUpdateUserPreferences() {
//        // Given
//        Long userId = 1L;
//        PreferenceUpdateDTO updateDTO = createPreferenceUpdateDTO();
//        UserPreference existingPreference = createUserPreference(userId);
//
//        when(preferenceRepository.findByUserId(userId))
//            .thenReturn(Optional.of(existingPreference));
//        when(preferenceValidator.validate(any())).thenReturn(true);
//        when(preferenceRepository.save(any())).thenReturn(existingPreference);
//
//        // When
//        UserPreference result = preferenceService.updatePreferences(userId, updateDTO);
//
//        // Then
//        assertThat(result.getCalorieGoal()).isEqualTo(2000);
//        assertThat(result.getDietaryRestrictions())
//            .contains("vegetarian");
//        verify(preferenceRepository).save(any());
//    }
//
//    @Test
//    void shouldCreateNewPreferencesIfNotExists() {
//        // Given
//        Long userId = 1L;
//        PreferenceUpdateDTO updateDTO = createPreferenceUpdateDTO();
//
//        when(preferenceRepository.findByUserId(userId))
//            .thenReturn(Optional.empty());
//        when(preferenceValidator.validate(any())).thenReturn(true);
//
//        // When
//        UserPreference result = preferenceService.updatePreferences(userId, updateDTO);
//
//        // Then
//        assertThat(result.getUserId()).isEqualTo(userId);
//        verify(preferenceRepository).save(any());
//    }
//
//    @Test
//    void shouldValidatePreferencesBeforeUpdate() {
//        // Given
//        Long userId = 1L;
//        PreferenceUpdateDTO invalidDTO = new PreferenceUpdateDTO();
//        when(preferenceValidator.validate(any())).thenReturn(false);
//
//        // When & Then
//        assertThatThrownBy(() ->
//            preferenceService.updatePreferences(userId, invalidDTO))
//            .isInstanceOf(InvalidPreferenceException.class);
//
//        verify(preferenceRepository, never()).save(any());
//    }
//
//    @Test
//    void shouldGetUserPreferences() {
//        // Given
//        Long userId = 1L;
//        UserPreference preference = createUserPreference(userId);
//
//        when(preferenceRepository.findByUserId(userId))
//            .thenReturn(Optional.of(preference));
//
//        // When
//        UserPreference result = preferenceService.getUserPreferences(userId);
//
//        // Then
//        assertThat(result.getCalorieGoal()).isEqualTo(2000);
//        assertThat(result.getMealReminders()).isTrue();
//    }
//
//    private PreferenceUpdateDTO createPreferenceUpdateDTO() {
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
//    private UserPreference createUserPreference(Long userId) {
//        return UserPreference.builder()
//            .userId(userId)
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
//}