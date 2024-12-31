package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.FoodAnalysisDTO;
//import com.foodrecord.model.FoodRecord;
//import com.foodrecord.repository.FoodRecordRepository;
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
//class FoodAnalysisServiceTest {
//
//    @Mock
//    private FoodRecordRepository recordRepository;
//
//    @Mock
//    private NutritionScorer nutritionScorer;
//
//    @InjectMocks
//    private FoodAnalysisServiceImpl analysisService;
//
//    @Test
//    void shouldAnalyzeFoodPatterns() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = createFoodRecords();
//        when(recordRepository.findByUserIdAndRecordTimeBetween(eq(userId), any(), any()))
//            .thenReturn(records);
//
//        // When
//        FoodAnalysisDTO analysis = analysisService.analyzeFoodPatterns(userId);
//
//        // Then
//        assertThat(analysis).isNotNull();
//        assertThat(analysis.getMostFrequentFoods()).isNotEmpty();
//    }
//
//    @Test
//    void shouldCalculateNutritionScore() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = createFoodRecords();
//        when(recordRepository.findByUserIdAndRecordTimeBetween(eq(userId), any(), any()))
//            .thenReturn(records);
//        when(nutritionScorer.calculateScore(any())).thenReturn(85.0);
//
//        // When
//        double score = analysisService.calculateNutritionScore(userId);
//
//        // Then
//        assertThat(score).isEqualTo(85.0);
//    }
//
//    @Test
//    void shouldIdentifyMealTimes() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = createFoodRecordsWithTimes();
//        when(recordRepository.findByUserIdAndRecordTimeBetween(eq(userId), any(), any()))
//            .thenReturn(records);
//
//        // When
//        Map<String, LocalTime> mealTimes = analysisService.identifyMealTimes(userId);
//
//        // Then
//        assertThat(mealTimes).containsKeys("breakfast", "lunch", "dinner");
//    }
//
//    @Test
//    void shouldHandleEmptyRecords() {
//        // Given
//        Long userId = 1L;
//        when(recordRepository.findByUserIdAndRecordTimeBetween(eq(userId), any(), any()))
//            .thenReturn(Arrays.asList());
//
//        // When
//        FoodAnalysisDTO analysis = analysisService.analyzeFoodPatterns(userId);
//
//        // Then
//        assertThat(analysis.getMostFrequentFoods()).isEmpty();
//        assertThat(analysis.getAverageCalories()).isZero();
//    }
//
//    private List<FoodRecord> createFoodRecords() {
//        return Arrays.asList(
//            createFoodRecord("Oatmeal", 300),
//            createFoodRecord("Chicken Salad", 450),
//            createFoodRecord("Salmon", 500)
//        );
//    }
//
//    private List<FoodRecord> createFoodRecordsWithTimes() {
//        return Arrays.asList(
//            createFoodRecordWithTime("Oatmeal", LocalDateTime.now().withHour(8)),
//            createFoodRecordWithTime("Salad", LocalDateTime.now().withHour(13)),
//            createFoodRecordWithTime("Dinner", LocalDateTime.now().withHour(19))
//        );
//    }
//
//    private FoodRecord createFoodRecord(String name, int calories) {
//        return FoodRecord.builder()
//            .foodName(name)
//            .calories(calories)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//
//    private FoodRecord createFoodRecordWithTime(String name, LocalDateTime time) {
//        return FoodRecord.builder()
//            .foodName(name)
//            .calories(400)
//            .recordTime(time)
//            .build();
//    }
//}