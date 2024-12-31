package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.repository.FoodRecordRepository;
//import com.foodrecord.model.NutritionAnalysis;
//import com.foodrecord.model.FoodRecord;
//import com.foodrecord.dto.AnalysisRequestDTO;
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
//class NutritionAnalysisServiceTest {
//
//    @Mock
//    private FoodRecordRepository recordRepository;
//
//    @Mock
//    private NutritionCalculator nutritionCalculator;
//
//    @Mock
//    private TrendAnalyzer trendAnalyzer;
//
//    @InjectMocks
//    private NutritionAnalysisServiceImpl analysisService;
//
//    @Test
//    void shouldAnalyzeNutritionForPeriod() {
//        // Given
//        AnalysisRequestDTO request = new AnalysisRequestDTO(1L, 7);
//        List<FoodRecord> records = createTestRecords();
//        DailyNutrition dailyNutrition = createDailyNutrition();
//
//        when(recordRepository.findByUserIdAndDateRange(anyLong(), any(), any()))
//            .thenReturn(records);
//        when(nutritionCalculator.calculateDailyTotals(any()))
//            .thenReturn(dailyNutrition);
//
//        // When
//        NutritionAnalysis analysis = analysisService.analyzeNutrition(request);
//
//        // Then
//        assertThat(analysis.getAverageCalories()).isEqualTo(2000);
//        assertThat(analysis.getProteinPercentage()).isEqualTo(20);
//        verify(nutritionCalculator).calculateDailyTotals(records);
//    }
//
//    @Test
//    void shouldAnalyzeNutritionTrends() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = createTestRecords();
//        List<String> trends = Arrays.asList(
//            "Consistent protein intake",
//            "Increasing fiber intake"
//        );
//
//        when(recordRepository.findByUserIdAndDateRange(anyLong(), any(), any()))
//            .thenReturn(records);
//        when(trendAnalyzer.analyzeTrends(any()))
//            .thenReturn(trends);
//
//        // When
//        List<String> result = analysisService.analyzeNutritionTrends(userId, 30);
//
//        // Then
//        assertThat(result).hasSize(2);
//        assertThat(result).contains("Consistent protein intake");
//        verify(trendAnalyzer).analyzeTrends(records);
//    }
//
//    @Test
//    void shouldGenerateNutritionSummary() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = createTestRecords();
//        MacroDistribution distribution = createMacroDistribution();
//
//        when(recordRepository.findRecentRecords(userId, 7))
//            .thenReturn(records);
//        when(nutritionCalculator.calculateMacroDistribution(any()))
//            .thenReturn(distribution);
//
//        // When
//        NutritionSummary summary = analysisService.generateNutritionSummary(userId);
//
//        // Then
//        assertThat(summary.getMacroDistribution().getProteinPercentage())
//            .isEqualTo(25.0);
//        assertThat(summary.getAverageCalories()).isEqualTo(2000);
//    }
//
//    @Test
//    void shouldHandleEmptyRecords() {
//        // Given
//        Long userId = 1L;
//        when(recordRepository.findByUserIdAndDateRange(anyLong(), any(), any()))
//            .thenReturn(Arrays.asList());
//
//        // When
//        NutritionAnalysis analysis = analysisService.analyzeNutrition(
//            new AnalysisRequestDTO(userId, 7));
//
//        // Then
//        assertThat(analysis.getAverageCalories()).isZero();
//        assertThat(analysis.getNutritionScore()).isZero();
//    }
//
//    private List<FoodRecord> createTestRecords() {
//        return Arrays.asList(
//            createFoodRecord(300, 15.0, 30.0, 10.0),
//            createFoodRecord(400, 20.0, 45.0, 15.0)
//        );
//    }
//
//    private FoodRecord createFoodRecord(
//            double calories, double protein, double carbs, double fat) {
//        return FoodRecord.builder()
//            .calories(calories)
//            .protein(protein)
//            .carbohydrates(carbs)
//            .fat(fat)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//
//    private DailyNutrition createDailyNutrition() {
//        return DailyNutrition.builder()
//            .totalCalories(2000)
//            .totalProtein(100)
//            .totalCarbs(250)
//            .totalFat(67)
//            .build();
//    }
//
//    private MacroDistribution createMacroDistribution() {
//        return MacroDistribution.builder()
//            .proteinPercentage(25.0)
//            .carbPercentage(50.0)
//            .fatPercentage(25.0)
//            .build();
//    }
//}