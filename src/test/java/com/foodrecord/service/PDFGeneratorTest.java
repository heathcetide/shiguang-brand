package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.ReportDTO;
//import com.foodrecord.config.PDFProperties;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import org.thymeleaf.spring5.SpringTemplateEngine;
//import org.thymeleaf.context.Context;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class PDFGeneratorTest {
//
//    @Mock
//    private SpringTemplateEngine templateEngine;
//
//    @Mock
//    private PDFProperties pdfProperties;
//
//    @InjectMocks
//    private PDFGeneratorImpl pdfGenerator;
//
//    @Test
//    void shouldGenerateWeeklyReportPDF() {
//        // Given
//        ReportDTO report = createWeeklyReport();
//        when(templateEngine.process(eq("weekly-report"), any(Context.class)))
//            .thenReturn("<html><body>Weekly Report</body></html>");
//
//        // When
//        byte[] pdfContent = pdfGenerator.generateWeeklyReport(report);
//
//        // Then
//        assertThat(pdfContent).isNotEmpty();
//        assertThat(pdfContent.length).isGreaterThan(100);
//    }
//
//    @Test
//    void shouldGenerateMonthlyReportPDF() {
//        // Given
//        ReportDTO report = createMonthlyReport();
//        when(templateEngine.process(eq("monthly-report"), any(Context.class)))
//            .thenReturn("<html><body>Monthly Report</body></html>");
//
//        // When
//        byte[] pdfContent = pdfGenerator.generateMonthlyReport(report);
//
//        // Then
//        assertThat(pdfContent).isNotEmpty();
//        assertThat(pdfContent.length).isGreaterThan(100);
//    }
//
//    @Test
//    void shouldHandlePDFGenerationError() {
//        // Given
//        ReportDTO report = createWeeklyReport();
//        when(templateEngine.process(any(), any()))
//            .thenThrow(new RuntimeException("Template processing failed"));
//
//        // When & Then
//        assertThatThrownBy(() -> pdfGenerator.generateWeeklyReport(report))
//            .isInstanceOf(PDFGenerationException.class);
//    }
//
//    @Test
//    void shouldApplyCustomStyles() {
//        // Given
//        ReportDTO report = createWeeklyReport();
//        when(pdfProperties.getCustomStyles()).thenReturn("custom.css");
//        when(templateEngine.process(eq("weekly-report"), any(Context.class)))
//            .thenReturn("<html><body>Styled Report</body></html>");
//
//        // When
//        byte[] pdfContent = pdfGenerator.generateWeeklyReport(report);
//
//        // Then
//        assertThat(pdfContent).isNotEmpty();
//        verify(pdfProperties).getCustomStyles();
//    }
//
//    private ReportDTO createWeeklyReport() {
//        return ReportDTO.builder()
//            .totalCalories(14000)
//            .averageDailyCalories(2000)
//            .weeklyGoalProgress(85)
//            .nutritionBalance(createNutritionBalance())
//            .build();
//    }
//
//    private ReportDTO createMonthlyReport() {
//        return ReportDTO.builder()
//            .totalCalories(60000)
//            .averageDailyCalories(2000)
//            .monthlyAnalysis(createMonthlyAnalysis())
//            .trends(createTrendAnalysis())
//            .build();
//    }
//
//    private NutritionBalance createNutritionBalance() {
//        return NutritionBalance.builder()
//            .proteinPercentage(25)
//            .carbPercentage(50)
//            .fatPercentage(25)
//            .build();
//    }
//
//    private MonthlyAnalysis createMonthlyAnalysis() {
//        return MonthlyAnalysis.builder()
//            .goalAchievementRate(90)
//            .mostFrequentMeals(Arrays.asList("Chicken Salad", "Oatmeal"))
//            .build();
//    }
//
//    private TrendAnalysis createTrendAnalysis() {
//        return TrendAnalysis.builder()
//            .caloriesTrend("Decreasing")
//            .proteinTrend("Stable")
//            .carbsTrend("Increasing")
//            .build();
//    }
//}