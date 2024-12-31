package com.foodrecord.controller;//package com.foodrecord.controller;
//
//import com.foodrecord.dto.ReportDTO;
//import com.foodrecord.service.ReportService;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
//import org.springframework.boot.test.mock.mockito.MockBean;
//import org.springframework.http.MediaType;
//import org.springframework.test.web.servlet.MockMvc;
//import com.fasterxml.jackson.databind.ObjectMapper;
//import java.time.LocalDate;
//
//import static org.mockito.Mockito.*;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@WebMvcTest(ReportController.class)
//class ReportControllerTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @Autowired
//    private ObjectMapper objectMapper;
//
//    @MockBean
//    private ReportService reportService;
//
//    @Test
//    void shouldGenerateWeeklyReport() throws Exception {
//        // Given
//        Long userId = 1L;
//        LocalDate startDate = LocalDate.now().minusDays(7);
//        ReportDTO report = createWeeklyReport();
//
//        when(reportService.generateWeeklyReport(userId, startDate))
//            .thenReturn(report);
//
//        // When & Then
//        mockMvc.perform(get("/api/reports/weekly")
//                .param("userId", userId.toString())
//                .param("startDate", startDate.toString()))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.totalCalories").exists())
//                .andExpect(jsonPath("$.weeklyGoalProgress").exists());
//    }
//
//    @Test
//    void shouldGenerateMonthlyReport() throws Exception {
//        // Given
//        Long userId = 1L;
//        int year = 2024;
//        int month = 1;
//        ReportDTO report = createMonthlyReport();
//
//        when(reportService.generateMonthlyReport(userId, year, month))
//            .thenReturn(report);
//
//        // When & Then
//        mockMvc.perform(get("/api/reports/monthly")
//                .param("userId", userId.toString())
//                .param("year", String.valueOf(year))
//                .param("month", String.valueOf(month)))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.monthlyAnalysis").exists());
//    }
//
//    @Test
//    void shouldExportReportAsPDF() throws Exception {
//        // Given
//        Long userId = 1L;
//        LocalDate startDate = LocalDate.now().minusDays(30);
//        byte[] pdfContent = "PDF Content".getBytes();
//
//        when(reportService.exportReportAsPDF(userId, startDate))
//            .thenReturn(pdfContent);
//
//        // When & Then
//        mockMvc.perform(get("/api/reports/export")
//                .param("userId", userId.toString())
//                .param("startDate", startDate.toString()))
//                .andExpect(status().isOk())
//                .andExpect(header().string("Content-Type", "application/pdf"));
//    }
//
//    @Test
//    void shouldHandleInvalidDateRange() throws Exception {
//        // Given
//        Long userId = 1L;
//        LocalDate invalidDate = LocalDate.now().plusDays(1);
//
//        // When & Then
//        mockMvc.perform(get("/api/reports/weekly")
//                .param("userId", userId.toString())
//                .param("startDate", invalidDate.toString()))
//                .andExpect(status().isBadRequest());
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