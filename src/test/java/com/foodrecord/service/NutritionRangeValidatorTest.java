package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.FoodRecordDTO;
//import com.foodrecord.model.NutritionRange;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.List;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class NutritionRangeValidatorTest {
//
//    @Mock
//    private NutritionRangeProvider rangeProvider;
//
//    @InjectMocks
//    private NutritionRangeValidatorImpl rangeValidator;
//
//    @Test
//    void shouldValidateValidNutritionValues() {
//        // Given
//        FoodRecordDTO recordDTO = createValidFoodRecordDTO();
//        NutritionRange range = createNutritionRange();
//
//        when(rangeProvider.getValidRange()).thenReturn(range);
//
//        // When
//        boolean isValid = rangeValidator.validate(recordDTO);
//
//        // Then
//        assertThat(isValid).isTrue();
//        assertThat(rangeValidator.getErrors(recordDTO)).isEmpty();
//    }
//
//    @Test
//    void shouldDetectInvalidCalories() {
//        // Given
//        FoodRecordDTO recordDTO = createFoodRecordDTO(-100, 20.0, 30.0, 10.0);
//        NutritionRange range = createNutritionRange();
//
//        when(rangeProvider.getValidRange()).thenReturn(range);
//
//        // When
//        boolean isValid = rangeValidator.validate(recordDTO);
//        List<String> errors = rangeValidator.getErrors(recordDTO);
//
//        // Then
//        assertThat(isValid).isFalse();
//        assertThat(errors).contains("Calories must be greater than 0");
//    }
//
//    @Test
//    void shouldDetectInvalidMacronutrientRatio() {
//        // Given
//        FoodRecordDTO recordDTO = createFoodRecordDTO(300, 80.0, 80.0, 80.0);
//        NutritionRange range = createNutritionRange();
//
//        when(rangeProvider.getValidRange()).thenReturn(range);
//
//        // When
//        boolean isValid = rangeValidator.validate(recordDTO);
//        List<String> errors = rangeValidator.getErrors(recordDTO);
//
//        // Then
//        assertThat(isValid).isFalse();
//        assertThat(errors).contains("Total macronutrient percentage exceeds 100%");
//    }
//
//    @Test
//    void shouldValidateNutrientRanges() {
//        // Given
//        FoodRecordDTO recordDTO = createFoodRecordDTO(300, 150.0, 30.0, 10.0);
//        NutritionRange range = createNutritionRange();
//
//        when(rangeProvider.getValidRange()).thenReturn(range);
//
//        // When
//        boolean isValid = rangeValidator.validate(recordDTO);
//        List<String> errors = rangeValidator.getErrors(recordDTO);
//
//        // Then
//        assertThat(isValid).isFalse();
//        assertThat(errors).contains("Protein exceeds maximum allowed value");
//    }
//
//    private FoodRecordDTO createValidFoodRecordDTO() {
//        return createFoodRecordDTO(300, 20.0, 30.0, 10.0);
//    }
//
//    private FoodRecordDTO createFoodRecordDTO(
//            double calories, double protein, double carbs, double fat) {
//        return FoodRecordDTO.builder()
//            .calories(calories)
//            .protein(protein)
//            .carbohydrates(carbs)
//            .fat(fat)
//            .build();
//    }
//
//    private NutritionRange createNutritionRange() {
//        return NutritionRange.builder()
//            .minCalories(0)
//            .maxCalories(5000)
//            .minProtein(0)
//            .maxProtein(100)
//            .minCarbs(0)
//            .maxCarbs(100)
//            .minFat(0)
//            .maxFat(100)
//            .build();
//    }
//}