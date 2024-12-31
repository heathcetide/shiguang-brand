package com.foodrecord.controller;//package com.foodrecord.controller;
//
//import com.foodrecord.dto.FoodAnalysisDTO;
//import com.foodrecord.service.FoodAnalysisService;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
//import org.springframework.boot.test.mock.mockito.MockBean;
//import org.springframework.http.MediaType;
//import org.springframework.test.web.servlet.MockMvc;
//import com.fasterxml.jackson.databind.ObjectMapper;
//import java.time.LocalDateTime;
//import java.util.Arrays;
//import java.util.Map;
//
//import static org.mockito.Mockito.*;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@WebMvcTest(FoodAnalysisController.class)
//class FoodAnalysisControllerTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @Autowired
//    private ObjectMapper objectMapper;
//
//    @MockBean
//    private FoodAnalysisService analysisService;
//
//    @Test
//    void shouldGetFoodPatterns() throws Exception {
//        // Given
//        Long userId = 1L;
//        FoodAnalysisDTO analysis = createFoodAnalysis();
//        when(analysisService.analyzeFoodPatterns(userId)).thenReturn(analysis);
//
//        // When & Then
//        mockMvc.perform(get("/api/analysis/patterns/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.mostFrequentFoods").exists())
//                .andExpect(jsonPath("$.averageCalories").exists());
//    }
//
//    @Test
//    void shouldGetNutritionScore() throws Exception {
//        // Given
//        Long userId = 1L;
//        when(analysisService.calculateNutritionScore(userId)).thenReturn(85.0);
//
//        // When & Then
//        mockMvc.perform(get("/api/analysis/score/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.score").value(85.0));
//    }
//
//    @Test
//    void shouldGetMealTimes() throws Exception {
//        // Given
//        Long userId = 1L;
//        Map<String, LocalTime> mealTimes = createMealTimes();
//        when(analysisService.identifyMealTimes(userId)).thenReturn(mealTimes);
//
//        // When & Then
//        mockMvc.perform(get("/api/analysis/meal-times/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.breakfast").exists())
//                .andExpect(jsonPath("$.lunch").exists());
//    }
//
//    @Test
//    void shouldHandleUserNotFound() throws Exception {
//        // Given
//        Long userId = 999L;
//        when(analysisService.analyzeFoodPatterns(userId))
//            .thenThrow(new UserNotFoundException("User not found"));
//
//        // When & Then
//        mockMvc.perform(get("/api/analysis/patterns/{userId}", userId))
//                .andExpect(status().isNotFound());
//    }
//
//    private FoodAnalysisDTO createFoodAnalysis() {
//        return FoodAnalysisDTO.builder()
//            .mostFrequentFoods(Arrays.asList("Oatmeal", "Chicken Salad"))
//            .averageCalories(2000.0)
//            .mealFrequency(Map.of("breakfast", 0.9, "lunch", 0.8))
//            .build();
//    }
//
//    private Map<String, LocalTime> createMealTimes() {
//        return Map.of(
//            "breakfast", LocalTime.of(8, 0),
//            "lunch", LocalTime.of(13, 0),
//            "dinner", LocalTime.of(19, 0)
//        );
//    }
//}