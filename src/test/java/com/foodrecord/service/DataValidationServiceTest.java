package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.FoodRecord;
//import com.foodrecord.model.ValidationResult;
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
//class DataValidationServiceTest {
//
//    @Mock
//    private NutritionValidator nutritionValidator;
//
//    @Mock
//    private TimeValidator timeValidator;
//
//    @InjectMocks
//    private DataValidationServiceImpl validationService;
//
//    @Test
//    void shouldValidateValidFoodRecord() {
//        // Given
//        FoodRecord record = createValidFoodRecord();
//
//        when(nutritionValidator.validate(any())).thenReturn(true);
//        when(timeValidator.validate(any())).thenReturn(true);
//
//        // When
//        ValidationResult result = validationService.validateFoodRecord(record);
//
//        // Then
//        assertThat(result.isValid()).isTrue();
//        assertThat(result.getErrors()).isEmpty();
//    }
//
//    @Test
//    void shouldDetectInvalidNutritionData() {
//        // Given
//        FoodRecord record = createInvalidNutritionRecord();
//
//        when(nutritionValidator.validate(any())).thenReturn(false);
//        when(nutritionValidator.getValidationErrors(any()))
//            .thenReturn(Arrays.asList("Invalid calorie value"));
//
//        // When
//        ValidationResult result = validationService.validateFoodRecord(record);
//
//        // Then
//        assertThat(result.isValid()).isFalse();
//        assertThat(result.getErrors()).contains("Invalid calorie value");
//    }
//
//    @Test
//    void shouldValidateBatchRecords() {
//        // Given
//        List<FoodRecord> records = Arrays.asList(
//            createValidFoodRecord(),
//            createInvalidNutritionRecord()
//        );
//
//        when(nutritionValidator.validate(any()))
//            .thenReturn(true)
//            .thenReturn(false);
//        when(timeValidator.validate(any())).thenReturn(true);
//
//        // When
//        BatchValidationResult result = validationService.validateBatch(records);
//
//        // Then
//        assertThat(result.getValidCount()).isEqualTo(1);
//        assertThat(result.getInvalidCount()).isEqualTo(1);
//        assertThat(result.getValidationErrors()).hasSize(1);
//    }
//
//    @Test
//    void shouldDetectTimeConflicts() {
//        // Given
//        List<FoodRecord> records = Arrays.asList(
//            createFoodRecordWithTime("08:00"),
//            createFoodRecordWithTime("08:00")
//        );
//
//        when(nutritionValidator.validate(any())).thenReturn(true);
//        when(timeValidator.validate(any())).thenReturn(false);
//        when(timeValidator.getValidationErrors(any()))
//            .thenReturn(Arrays.asList("Time conflict detected"));
//
//        // When
//        BatchValidationResult result = validationService.validateBatch(records);
//
//        // Then
//        assertThat(result.hasTimeConflicts()).isTrue();
//        assertThat(result.getTimeConflicts()).hasSize(1);
//    }
//
//    private FoodRecord createValidFoodRecord() {
//        return FoodRecord.builder()
//            .foodName("Apple")
//            .calories(95)
//            .protein(0.5)
//            .carbohydrates(25.0)
//            .fat(0.3)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//
//    private FoodRecord createInvalidNutritionRecord() {
//        return FoodRecord.builder()
//            .foodName("Invalid Food")
//            .calories(-100)
//            .protein(-1.0)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//
//    private FoodRecord createFoodRecordWithTime(String time) {
//        return FoodRecord.builder()
//            .foodName("Test Food")
//            .calories(100)
//            .recordTime(LocalDateTime.parse(
//                LocalDateTime.now().toLocalDate() + "T" + time))
//            .build();
//    }
//}