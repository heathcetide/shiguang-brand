package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.NutritionInfo;
//import com.foodrecord.model.MacroDistribution;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.Arrays;
//import java.util.List;
//
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class MacronutrientCalculatorTest {
//
//    @InjectMocks
//    private MacronutrientCalculatorImpl macroCalculator;
//
//    @Test
//    void shouldCalculateMacroDistribution() {
//        // Given
//        List<NutritionInfo> nutritionInfoList = Arrays.asList(
//            createNutritionInfo(300, 20.0, 30.0, 10.0),
//            createNutritionInfo(300, 20.0, 30.0, 10.0)
//        );
//
//        // When
//        MacroDistribution distribution =
//            macroCalculator.calculateDistribution(nutritionInfoList);
//
//        // Then
//        assertThat(distribution.getProteinPercentage()).isEqualTo(33.33, within(0.01));
//        assertThat(distribution.getCarbPercentage()).isEqualTo(50.0, within(0.01));
//        assertThat(distribution.getFatPercentage()).isEqualTo(16.67, within(0.01));
//    }
//
//    @Test
//    void shouldAdjustForPortion() {
//        // Given
//        NutritionInfo baseInfo = createNutritionInfo(100, 5.0, 15.0, 3.0);
//        double portion = 2.5;
//
//        // When
//        NutritionInfo adjusted = macroCalculator.adjustForPortion(baseInfo, portion);
//
//        // Then
//        assertThat(adjusted.getCalories()).isEqualTo(250);
//        assertThat(adjusted.getProtein()).isEqualTo(12.5);
//        assertThat(adjusted.getCarbohydrates()).isEqualTo(37.5);
//        assertThat(adjusted.getFat()).isEqualTo(7.5);
//    }
//
//    @Test
//    void shouldCalculateCaloriesFromMacros() {
//        // Given
//        NutritionInfo info = createNutritionInfo(0, 20.0, 30.0, 10.0);
//
//        // When
//        double calories = macroCalculator.calculateCalories(info);
//
//        // Then
//        // Protein: 20g * 4 = 80 cal
//        // Carbs: 30g * 4 = 120 cal
//        // Fat: 10g * 9 = 90 cal
//        // Total: 290 cal
//        assertThat(calories).isEqualTo(290);
//    }
//
//    @Test
//    void shouldHandleZeroValues() {
//        // Given
//        NutritionInfo zeroInfo = createNutritionInfo(0, 0.0, 0.0, 0.0);
//
//        // When
//        MacroDistribution distribution =
//            macroCalculator.calculateDistribution(Arrays.asList(zeroInfo));
//
//        // Then
//        assertThat(distribution.getProteinPercentage()).isZero();
//        assertThat(distribution.getCarbPercentage()).isZero();
//        assertThat(distribution.getFatPercentage()).isZero();
//    }
//
//    @Test
//    void shouldCalculateAverageMacroRatios() {
//        // Given
//        List<NutritionInfo> infoList = Arrays.asList(
//            createNutritionInfo(300, 15.0, 45.0, 10.0),
//            createNutritionInfo(300, 25.0, 35.0, 10.0)
//        );
//
//        // When
//        MacroDistribution average = macroCalculator.calculateAverageRatios(infoList);
//
//        // Then
//        assertThat(average.getProteinPercentage()).isEqualTo(33.33, within(0.01));
//        assertThat(average.getCarbPercentage()).isEqualTo(50.0, within(0.01));
//        assertThat(average.getFatPercentage()).isEqualTo(16.67, within(0.01));
//    }
//
//    private NutritionInfo createNutritionInfo(
//            double calories, double protein, double carbs, double fat) {
//        return NutritionInfo.builder()
//            .calories(calories)
//            .protein(protein)
//            .carbohydrates(carbs)
//            .fat(fat)
//            .build();
//    }
//}