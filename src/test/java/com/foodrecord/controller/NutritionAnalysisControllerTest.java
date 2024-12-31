package com.foodrecord.controller;//package com.foodrecord.controller;
//
//import com.foodrecord.dto.AnalysisRequestDTO;
//import com.foodrecord.dto.NutritionAnalysisDTO;
//import com.foodrecord.service.NutritionAnalysisService;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
//import org.springframework.boot.test.mock.mockito.MockBean;
//import org.springframework.http.MediaType;
//import org.springframework.test.web.servlet.MockMvc;
//import com.fasterxml.jackson.databind.ObjectMapper;
//import java.util.Arrays;
//
//import static org.mockito.Mockito.*;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@WebMvcTest(NutritionAnalysisController.class)
//class NutritionAnalysisControllerTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @Autowired
//    private ObjectMapper objectMapper;
//
//    @MockBean
//    private NutritionAnalysisService analysisService;
//
//    @Test
//    void shouldGetNutritionAnalysis() throws Exception {
//        // Given
//        Long userId = 1L;
//        AnalysisRequestDTO request = new AnalysisRequestDTO(userId, 7);
//        NutritionAnalysisDTO analysis = createAnalysisDTO();
//
//        when(analysisService.analyzeNutrition(any()))
//            .thenReturn(analysis);
//
//        // When & Then
//        mockMvc.perform(post("/api/nutrition/analyze")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(request)))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.averageCalories").exists())
//                .andExpect(jsonPath("$.nutritionScore").exists());
//    }
//
//    @Test
//    void shouldGetNutritionTrends() throws Exception {
//        // Given
//        Long userId = 1L;
//        when(analysisService.getNutritionTrends(userId))
//            .thenReturn(Arrays.asList(createTrendDTO()));
//
//        // When & Then
//        mockMvc.perform(get("/api/nutrition/trends/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$[0].trend").exists());
//    }
//
//    @Test
//    void shouldGetNutritionSummary() throws Exception {
//        // Given
//        Long userId = 1L;
//        when(analysisService.getNutritionSummary(userId))
//            .thenReturn(createSummaryDTO());
//
//        // When & Then
//        mockMvc.perform(get("/api/nutrition/summary/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.totalCalories").exists());
//    }
//
//    @Test
//    void shouldHandleInvalidAnalysisRequest() throws Exception {
//        // Given
//        AnalysisRequestDTO invalidRequest = new AnalysisRequestDTO(null, -1);
//
//        // When & Then
//        mockMvc.perform(post("/api/nutrition/analyze")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(invalidRequest)))
//                .andExpect(status().isBadRequest());
//    }
//
//    private NutritionAnalysisDTO createAnalysisDTO() {
//        return NutritionAnalysisDTO.builder()
//            .averageCalories(2000.0)
//            .nutritionScore(8.5)
//            .proteinPercentage(25.0)
//            .carbPercentage(50.0)
//            .fatPercentage(25.0)
//            .build();
//    }
//
//    private TrendDTO createTrendDTO() {
//        return TrendDTO.builder()
//            .trend("Increasing protein intake")
//            .confidence(0.85)
//            .period("Last 7 days")
//            .build();
//    }
//
//    private NutritionSummaryDTO createSummaryDTO() {
//        return NutritionSummaryDTO.builder()
//            .totalCalories(14000)
//            .averageProtein(85.0)
//            .averageCarbs(250.0)
//            .averageFat(65.0)
//            .build();
//    }
//}