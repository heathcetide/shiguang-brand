package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.ReportDTO;
//import com.foodrecord.model.FoodRecord;
//import com.foodrecord.repository.FoodRecordRepository;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.time.LocalDate;
//import java.util.List;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class ReportServiceTest {
//
//    @Mock
//    private FoodRecordRepository recordRepository;
//
//    @Mock
//    private NutritionAnalyzer nutritionAnalyzer;
//
//    @Mock
//    private PDFGenerator pdfGenerator;
//
//    @InjectMocks
//    private ReportServiceImpl reportService;
//
//    @Test
//    void shouldGenerateWeeklyReport() {
//        // Given
//        Long userId = 1L;
//        LocalDate startDate = LocalDate.now().minusDays(7);
//        List<FoodRecord> records = createWeeklyRecords();
//
//        when(recordRepository.findByUserIdAndDateBetween(eq(userId), any(), any()))
//            .thenReturn(records);
//        when(nutritionAnalyzer.analyzeNutrition(records))
//            .thenReturn(createNutritionAnalysis());
//
//        // When
//        ReportDTO report = reportService.generateWeeklyReport(userId, startDate);
//
//        // Then
//        assertThat(report).isNotNull();
//        assertThat(report.getTotalCalories()).isPositive();
//        verify(nutritionAnalyzer).analyzeNutrition(records);
//    }
//
//    @Test
//    void shouldGenerateMonthlyReport() {
//        // Given
//        Long userId = 1L;
//        int year = 2024;
//        int month = 1;
//        List<FoodRecord> records = createMonthlyRecords();
//
//        when(recordRepository.findByUserIdAndYearAndMonth(userId, year, month))
//            .thenReturn(records);
//
//        // When
//        ReportDTO report = reportService.generateMonthlyReport(userId, year, month);
//
//        // Then
//        assertThat(report).isNotNull();
//        assertThat(report.getMonthlyAnalysis()).isNotNull();
//    }
//
//    @Test
//    void shouldExportReportAsPDF() {
//        // Given
//        Long userId = 1L;
//        LocalDate startDate = LocalDate.now().minusDays(30);
//        ReportDTO report = createMonthlyReport();
//        byte[] expectedPdf = "PDF Content".getBytes();
//
//        when(recordRepository.findByUserIdAndDateBetween(eq(userId), any(), any()))
//            .thenReturn(createMonthlyRecords());
//        when(pdfGenerator.generatePDF(any())).thenReturn(expectedPdf);
//
//        // When
//        byte[] result = reportService.exportReportAsPDF(userId, startDate);
//
//        // Then
//        assertThat(result).isEqualTo(expectedPdf);
//        verify(pdfGenerator).generatePDF(any());
//    }
//
//    @Test
//    void shouldValidateDateRange() {
//        // Given
//        LocalDate invalidDate = LocalDate.now().plusDays(1);
//
//        // When & Then
//        assertThatThrownBy(() ->
//            reportService.generateWeeklyReport(1L, invalidDate))
//            .isInstanceOf(InvalidDateRangeException.class);
//    }
//
//    private List<FoodRecord> createWeeklyRecords() {
//        return Arrays.asList(
//            createFoodRecord(2000, LocalDateTime.now().minusDays(1)),
//            createFoodRecord(1800, LocalDateTime.now().minusDays(2)),
//            createFoodRecord(2200, LocalDateTime.now().minusDays(3))
//        );
//    }
//
//    private List<FoodRecord> createMonthlyRecords() {
//        return Arrays.asList(
//            createFoodRecord(2000, LocalDateTime.now().minusDays(1)),
//            createFoodRecord(1900, LocalDateTime.now().minusDays(15)),
//            createFoodRecord(2100, LocalDateTime.now().minusDays(30))
//        );
//    }
//
//    private FoodRecord createFoodRecord(int calories, LocalDateTime dateTime) {
//        return FoodRecord.builder()
//            .calories(calories)
//            .recordTime(dateTime)
//            .build();
//    }
//
//    private NutritionAnalysis createNutritionAnalysis() {
//        return NutritionAnalysis.builder()
//            .averageCalories(2000.0)
//            .proteinPercentage(25.0)
//            .carbPercentage(50.0)
//            .fatPercentage(25.0)
//            .build();
//    }
//}