package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.repository.FoodRecordRepository;
//import com.foodrecord.model.FoodRecord;
//import com.foodrecord.dto.StatisticsDTO;
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
//class FoodRecordStatisticsServiceTest {
//
//    @Mock
//    private FoodRecordRepository recordRepository;
//
//    @Mock
//    private StatisticsCalculator statisticsCalculator;
//
//    @InjectMocks
//    private FoodRecordStatisticsServiceImpl statisticsService;
//
//    @Test
//    void shouldCalculateWeeklyStatistics() {
//        // Given
//        Long userId = 1L;
//        LocalDateTime startDate = LocalDateTime.now().minusDays(7);
//        LocalDateTime endDate = LocalDateTime.now();
//
//        List<FoodRecord> records = Arrays.asList(
//            createTestRecord(1L, "Breakfast", 300),
//            createTestRecord(2L, "Lunch", 500),
//            createTestRecord(3L, "Dinner", 700)
//        );
//
//        when(recordRepository.findByUserIdAndDateRange(userId, startDate, endDate))
//            .thenReturn(records);
//
//        // When
//        WeeklyStatistics stats = statisticsService.calculateWeeklyStats(userId);
//
//        // Then
//        assertThat(stats.getTotalCalories()).isEqualTo(1500);
//        assertThat(stats.getAverageCaloriesPerDay()).isEqualTo(1500.0 / 7);
//        assertThat(stats.getMealCount()).isEqualTo(3);
//    }
//
//    @Test
//    void shouldGenerateNutritionTrends() {
//        // Given
//        Long userId = 1L;
//        List<DailyNutrition> dailyNutrition = Arrays.asList(
//            createDailyNutrition(LocalDateTime.now().minusDays(2), 2000),
//            createDailyNutrition(LocalDateTime.now().minusDays(1), 1800),
//            createDailyNutrition(LocalDateTime.now(), 2200)
//        );
//
//        when(statisticsCalculator.calculateDailyNutrition(any(), any()))
//            .thenReturn(dailyNutrition);
//
//        // When
//        NutritionTrends trends = statisticsService.analyzeNutritionTrends(userId);
//
//        // Then
//        assertThat(trends.getAverageCalories()).isEqualTo(2000.0);
//        assertThat(trends.getCalorieTrend()).isEqualTo(TrendDirection.INCREASING);
//        verify(statisticsCalculator).calculateDailyNutrition(eq(userId), any());
//    }
//
//    @Test
//    void shouldGenerateMealPatternAnalysis() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = Arrays.asList(
//            createTestRecord(1L, "Breakfast", 300, "08:00"),
//            createTestRecord(2L, "Lunch", 500, "13:00"),
//            createTestRecord(3L, "Dinner", 700, "19:00")
//        );
//
//        when(recordRepository.findByUserIdAndDateRange(any(), any(), any()))
//            .thenReturn(records);
//
//        // When
//        MealPatternAnalysis analysis = statisticsService.analyzeMealPatterns(userId);
//
//        // Then
//        assertThat(analysis.getMealTimings()).hasSize(3);
//        assertThat(analysis.getMostCommonMealTime("Breakfast")).isEqualTo("08:00");
//        assertThat(analysis.getAverageMealSpacing()).isGreaterThan(Duration.ofHours(4));
//    }
//
//    @Test
//    void shouldCalculateNutrientDistribution() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = Arrays.asList(
//            createTestRecordWithNutrients(1L, 30, 40, 30),
//            createTestRecordWithNutrients(2L, 25, 45, 30)
//        );
//
//        when(recordRepository.findRecentRecords(eq(userId), anyInt()))
//            .thenReturn(records);
//
//        // When
//        NutrientDistribution distribution =
//            statisticsService.calculateNutrientDistribution(userId);
//
//        // Then
//        assertThat(distribution.getAverageProteinPercentage()).isEqualTo(27.5);
//        assertThat(distribution.getAverageCarbPercentage()).isEqualTo(42.5);
//        assertThat(distribution.getAverageFatPercentage()).isEqualTo(30.0);
//    }
//
//    private FoodRecord createTestRecord(Long id, String name, int calories) {
//        FoodRecord record = new FoodRecord();
//        record.setId(id);
//        record.setFoodName(name);
//        record.setCalories(calories);
//        record.setRecordTime(LocalDateTime.now());
//        return record;
//    }
//
//    private FoodRecord createTestRecord(Long id, String name, int calories, String time) {
//        FoodRecord record = createTestRecord(id, name, calories);
//        record.setRecordTime(LocalDateTime.parse(LocalDateTime.now().toLocalDate() + "T" + time));
//        return record;
//    }
//
//    private FoodRecord createTestRecordWithNutrients(
//            Long id, double protein, double carbs, double fat) {
//        FoodRecord record = createTestRecord(id, "Test Food", 100);
//        record.setProtein(protein);
//        record.setCarbohydrates(carbs);
//        record.setFat(fat);
//        return record;
//    }
//
//    private DailyNutrition createDailyNutrition(LocalDateTime date, int calories) {
//        return DailyNutrition.builder()
//            .date(date)
//            .totalCalories(calories)
//            .mealCount(3)
//            .build();
//    }
//}