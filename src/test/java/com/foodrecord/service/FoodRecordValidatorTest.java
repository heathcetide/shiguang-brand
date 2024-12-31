package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.FoodRecordDTO;
//import com.foodrecord.model.ValidationResult;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.time.LocalDateTime;
//import java.util.List;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class FoodRecordValidatorTest {
//
//    @Mock
//    private NutritionRangeValidator nutritionRangeValidator;
//
//    @Mock
//    private TimeValidator timeValidator;
//
//    @InjectMocks
//    private FoodRecordValidatorImpl recordValidator;
//
//    @Test
//    void shouldValidateValidRecord() {
//        // Given
//        FoodRecordDTO recordDTO = createValidFoodRecordDTO();
//
//        when(nutritionRangeValidator.isValid(any())).thenReturn(true);
//        when(timeValidator.isValid(any())).thenReturn(true);
//
//        // When
//        ValidationResult result = recordValidator.validate(recordDTO);
//
//        // Then
//        assertThat(result.isValid()).isTrue();
//        assertThat(result.getErrors()).isEmpty();
//    }
//
//    @Test
//    void shouldDetectInvalidNutritionValues() {
//        // Given
//        FoodRecordDTO recordDTO = createInvalidNutritionRecordDTO();
//
//        when(nutritionRangeValidator.isValid(any())).thenReturn(false);
//        when(nutritionRangeValidator.getErrors(any()))
//            .thenReturn(List.of("Invalid calorie value"));
//
//        // When
//        ValidationResult result = recordValidator.validate(recordDTO);
//
//        // Then
//        assertThat(result.isValid()).isFalse();
//        assertThat(result.getErrors())
//            .contains("Invalid calorie value");
//    }
//
//    @Test
//    void shouldDetectInvalidTimeFormat() {
//        // Given
//        FoodRecordDTO recordDTO = createInvalidTimeRecordDTO();
//
//        when(timeValidator.isValid(any())).thenReturn(false);
//        when(timeValidator.getErrors(any()))
//            .thenReturn(List.of("Invalid time format"));
//
//        // When
//        ValidationResult result = recordValidator.validate(recordDTO);
//
//        // Then
//        assertThat(result.isValid()).isFalse();
//        assertThat(result.getErrors())
//            .contains("Invalid time format");
//    }
//
//    @Test
//    void shouldValidateRequiredFields() {
//        // Given
//        FoodRecordDTO recordDTO = new FoodRecordDTO();
//        // Missing required fields
//
//        // When
//        ValidationResult result = recordValidator.validate(recordDTO);
//
//        // Then
//        assertThat(result.isValid()).isFalse();
//        assertThat(result.getErrors())
//            .contains("Food name is required")
//            .contains("User ID is required");
//    }
//
//    private FoodRecordDTO createValidFoodRecordDTO() {
//        return FoodRecordDTO.builder()
//            .userId(1L)
//            .foodName("Apple")
//            .calories(95)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//
//    private FoodRecordDTO createInvalidNutritionRecordDTO() {
//        return FoodRecordDTO.builder()
//            .userId(1L)
//            .foodName("Invalid Food")
//            .calories(-100)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//
//    private FoodRecordDTO createInvalidTimeRecordDTO() {
//        return FoodRecordDTO.builder()
//            .userId(1L)
//            .foodName("Apple")
//            .calories(95)
//            .recordTime(null)
//            .build();
//    }
//}