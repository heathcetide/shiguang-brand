package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.FoodRecord;
//import com.foodrecord.model.NutritionTrend;
//import com.foodrecord.dto.TrendAnalysisDTO;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.time.LocalDateTime;
//import java.util.Arrays;
//import java.util.List;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class TrendAnalyzerTest {
//
//    @Mock
//    private FoodRecordService foodRecordService;
//
//    @InjectMocks
//    private TrendAnalyzerImpl trendAnalyzer;
//
//    @Test
//    void shouldAnalyzeCalorieTrend() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = createFoodRecordsWithIncreasingCalories();
//        when(foodRecordService.getUserRecordsForPeriod(eq(userId), any(), any()))
//            .thenReturn(records);
//
//        // When
//        TrendAnalysisDTO trend = trendAnalyzer.analyzeCalorieTrend(userId, 7);
//
//        // Then
//        assertThat(trend.getTrendDirection()).isEqualTo(TrendDirection.INCREASING);
//        assertThat(trend.getConfidence()).isGreaterThan(0.8);
//    }
//
//    @Test
//    void shouldAnalyzeNutrientDistribution() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = createFoodRecordsWithVaryingNutrients();
//        when(foodRecordService.getUserRecordsForPeriod(eq(userId), any(), any()))
//            .thenReturn(records);
//
//        // When
//        NutritionTrend trend = trendAnalyzer.analyzeNutrientDistribution(userId, 7);
//
//        // Then
//        assertThat(trend.getProteinPercentage()).isBetween(20.0, 30.0);
//        assertThat(trend.getCarbPercentage()).isBetween(45.0, 55.0);
//        assertThat(trend.getFatPercentage()).isBetween(25.0, 35.0);
//    }
//
//    @Test
//    void shouldDetectMealPatterns() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = createFoodRecordsWithMealPatterns();
//        when(foodRecordService.getUserRecordsForPeriod(eq(userId), any(), any()))
//            .thenReturn(records);
//
//        // When
//        List<MealPattern> patterns = trendAnalyzer.detectMealPatterns(userId, 7);
//
//        // Then
//        assertThat(patterns).hasSize(3); // breakfast, lunch, dinner
//        assertThat(patterns.get(0).getAverageTime().getHour()).isLessThan(11); // breakfast
//    }
//
//    @Test
//    void shouldHandleEmptyRecords() {
//        // Given
//        Long userId = 1L;
//        when(foodRecordService.getUserRecordsForPeriod(eq(userId), any(), any()))
//            .thenReturn(Arrays.asList());
//
//        // When
//        TrendAnalysisDTO trend = trendAnalyzer.analyzeCalorieTrend(userId, 7);
//
//        // Then
//        assertThat(trend.getTrendDirection()).isEqualTo(TrendDirection.STABLE);
//        assertThat(trend.getConfidence()).isZero();
//    }
//
//    private List<FoodRecord> createFoodRecordsWithIncreasingCalories() {
//        return Arrays.asList(
//            createFoodRecord(1800, LocalDateTime.now().minusDays(3)),
//            createFoodRecord(2000, LocalDateTime.now().minusDays(2)),
//            createFoodRecord(2200, LocalDateTime.now().minusDays(1))
//        );
//    }
//
//    private List<FoodRecord> createFoodRecordsWithVaryingNutrients() {
//        return Arrays.asList(
//            createFoodRecordWithNutrients(2000, 150, 250, 67),
//            createFoodRecordWithNutrients(2100, 160, 260, 70),
//            createFoodRecordWithNutrients(1900, 140, 240, 63)
//        );
//    }
//
//    private List<FoodRecord> createFoodRecordsWithMealPatterns() {
//        return Arrays.asList(
//            createFoodRecord(400, LocalDateTime.now().withHour(8)),
//            createFoodRecord(700, LocalDateTime.now().withHour(13)),
//            createFoodRecord(800, LocalDateTime.now().withHour(19))
//        );
//    }
//
//    private FoodRecord createFoodRecord(int calories, LocalDateTime time) {
//        return FoodRecord.builder()
//            .calories(calories)
//            .recordTime(time)
//            .build();
//    }
//
//    private FoodRecord createFoodRecordWithNutrients(int calories, double protein,
//            double carbs, double fat) {
//        return FoodRecord.builder()
//            .calories(calories)
//            .protein(protein)
//            .carbohydrates(carbs)
//            .fat(fat)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//}