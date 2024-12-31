package com.foodrecord.controller;//package com.foodrecord.controller;
//
//import com.foodrecord.dto.StatisticsDTO;
//import com.foodrecord.service.StatisticsService;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
//import org.springframework.boot.test.mock.mockito.MockBean;
//import org.springframework.test.web.servlet.MockMvc;
//import java.time.LocalDate;
//
//import static org.mockito.Mockito.*;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@WebMvcTest(StatisticsController.class)
//class StatisticsControllerTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @MockBean
//    private StatisticsService statisticsService;
//
//    @Test
//    void shouldGetDailyStatistics() throws Exception {
//        // Given
//        Long userId = 1L;
//        LocalDate date = LocalDate.now();
//        when(statisticsService.getDailyStatistics(userId, date))
//            .thenReturn(createDailyStatistics());
//
//        // When & Then
//        mockMvc.perform(get("/api/statistics/daily")
//                .param("userId", userId.toString())
//                .param("date", date.toString()))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.totalCalories").exists())
//                .andExpect(jsonPath("$.mealCount").exists());
//    }
//
//    @Test
//    void shouldGetWeeklyStatistics() throws Exception {
//        // Given
//        Long userId = 1L;
//        LocalDate startDate = LocalDate.now().minusDays(7);
//        when(statisticsService.getWeeklyStatistics(userId, startDate))
//            .thenReturn(createWeeklyStatistics());
//
//        // When & Then
//        mockMvc.perform(get("/api/statistics/weekly")
//                .param("userId", userId.toString())
//                .param("startDate", startDate.toString()))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.dailyAverageCalories").exists());
//    }
//
//    @Test
//    void shouldGetMealTimeDistribution() throws Exception {
//        // Given
//        Long userId = 1L;
//        when(statisticsService.getMealTimeDistribution(userId))
//            .thenReturn(createMealDistribution());
//
//        // When & Then
//        mockMvc.perform(get("/api/statistics/meal-distribution/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.breakfast").exists())
//                .andExpect(jsonPath("$.lunch").exists())
//                .andExpect(jsonPath("$.dinner").exists());
//    }
//
//    @Test
//    void shouldGetNutritionProgress() throws Exception {
//        // Given
//        Long userId = 1L;
//        when(statisticsService.getNutritionProgress(userId))
//            .thenReturn(createNutritionProgress());
//
//        // When & Then
//        mockMvc.perform(get("/api/statistics/nutrition-progress/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.calorieGoalProgress").exists())
//                .andExpect(jsonPath("$.proteinGoalProgress").exists());
//    }
//
//    private StatisticsDTO createDailyStatistics() {
//        return StatisticsDTO.builder()
//            .totalCalories(2000)
//            .mealCount(3)
//            .proteinGrams(75)
//            .carbGrams(250)
//            .fatGrams(67)
//            .build();
//    }
//
//    private WeeklyStatisticsDTO createWeeklyStatistics() {
//        return WeeklyStatisticsDTO.builder()
//            .dailyAverageCalories(2100)
//            .totalMeals(21)
//            .caloriesTrend(Arrays.asList(1900, 2000, 2100, 2200, 2000, 2150, 2200))
//            .build();
//    }
//
//    private MealDistributionDTO createMealDistribution() {
//        return MealDistributionDTO.builder()
//            .breakfast(25)
//            .lunch(35)
//            .dinner(40)
//            .build();
//    }
//
//    private NutritionProgressDTO createNutritionProgress() {
//        return NutritionProgressDTO.builder()
//            .calorieGoalProgress(85)
//            .proteinGoalProgress(90)
//            .carbGoalProgress(80)
//            .fatGoalProgress(85)
//            .build();
//    }
//}