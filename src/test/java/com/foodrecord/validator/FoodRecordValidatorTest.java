package com.foodrecord.validator;//package com.foodrecord.validator;
//
//import com.foodrecord.dto.FoodRecordDTO;
//import com.foodrecord.exception.ValidationException;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.time.LocalDateTime;
//import java.util.List;
//
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class FoodRecordValidatorTest {
//
//    @InjectMocks
//    private FoodRecordValidator validator;
//
//    @Test
//    void shouldValidateValidRecord() {
//        // Given
//        FoodRecordDTO record = createValidFoodRecord();
//
//        // When
//        List<String> errors = validator.validate(record);
//
//        // Then
//        assertThat(errors).isEmpty();
//    }
//
//    @Test
//    void shouldValidateNegativeCalories() {
//        // Given
//        FoodRecordDTO record = createFoodRecordWithNegativeCalories();
//
//        // When
//        List<String> errors = validator.validate(record);
//
//        // Then
//        assertThat(errors).contains("Calories must be positive");
//    }
//
//    @Test
//    void shouldValidateFutureDate() {
//        // Given
//        FoodRecordDTO record = createFoodRecordWithFutureDate();
//
//        // When
//        List<String> errors = validator.validate(record);
//
//        // Then
//        assertThat(errors).contains("Record date cannot be in the future");
//    }
//
//    @Test
//    void shouldValidateNutritionValues() {
//        // Given
//        FoodRecordDTO record = createFoodRecordWithInvalidNutrition();
//
//        // When
//        List<String> errors = validator.validate(record);
//
//        // Then
//        assertThat(errors).contains("Invalid nutrition values");
//    }
//
//    private FoodRecordDTO createValidFoodRecord() {
//        return FoodRecordDTO.builder()
//            .userId(1L)
//            .foodName("Apple")
//            .calories(95)
//            .protein(0.5)
//            .carbohydrates(25.0)
//            .fat(0.3)
//            .recordTime(LocalDateTime.now().minusHours(1))
//            .build();
//    }
//
//    private FoodRecordDTO createFoodRecordWithNegativeCalories() {
//        return FoodRecordDTO.builder()
//            .userId(1L)
//            .foodName("Apple")
//            .calories(-95)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//
//    private FoodRecordDTO createFoodRecordWithFutureDate() {
//        return FoodRecordDTO.builder()
//            .userId(1L)
//            .foodName("Apple")
//            .calories(95)
//            .recordTime(LocalDateTime.now().plusDays(1))
//            .build();
//    }
//
//    private FoodRecordDTO createFoodRecordWithInvalidNutrition() {
//        return FoodRecordDTO.builder()
//            .userId(1L)
//            .foodName("Apple")
//            .calories(95)
//            .protein(-0.5)
//            .carbohydrates(250.0)
//            .fat(-0.3)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//}