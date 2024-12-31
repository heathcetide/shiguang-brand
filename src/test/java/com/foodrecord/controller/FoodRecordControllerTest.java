package com.foodrecord.controller;//package com.foodrecord.controller;
//
//import com.foodrecord.dto.FoodRecordDTO;
//import com.foodrecord.service.FoodRecordService;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
//import org.springframework.boot.test.mock.mockito.MockBean;
//import org.springframework.http.MediaType;
//import org.springframework.test.web.servlet.MockMvc;
//import com.fasterxml.jackson.databind.ObjectMapper;
//import java.time.LocalDateTime;
//import java.util.Arrays;
//
//import static org.mockito.Mockito.*;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@WebMvcTest(FoodRecordController.class)
//class FoodRecordControllerTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @Autowired
//    private ObjectMapper objectMapper;
//
//    @MockBean
//    private FoodRecordService foodRecordService;
//
//    @Test
//    void shouldCreateFoodRecord() throws Exception {
//        // Given
//        FoodRecordDTO recordDTO = createFoodRecordDTO();
//        when(foodRecordService.createFoodRecord(any())).thenReturn(recordDTO);
//
//        // When & Then
//        mockMvc.perform(post("/api/records")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(recordDTO)))
//                .andExpect(status().isCreated())
//                .andExpect(jsonPath("$.foodName").value(recordDTO.getFoodName()));
//    }
//
//    @Test
//    void shouldGetUserRecords() throws Exception {
//        // Given
//        Long userId = 1L;
//        when(foodRecordService.getUserRecords(userId))
//            .thenReturn(Arrays.asList(createFoodRecordDTO()));
//
//        // When & Then
//        mockMvc.perform(get("/api/records/user/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$[0].foodName").exists());
//    }
//
//    @Test
//    void shouldUpdateFoodRecord() throws Exception {
//        // Given
//        Long recordId = 1L;
//        FoodRecordDTO recordDTO = createFoodRecordDTO();
//        when(foodRecordService.updateFoodRecord(eq(recordId), any()))
//            .thenReturn(recordDTO);
//
//        // When & Then
//        mockMvc.perform(put("/api/records/{id}", recordId)
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(recordDTO)))
//                .andExpect(status().isOk());
//    }
//
//    @Test
//    void shouldDeleteFoodRecord() throws Exception {
//        // Given
//        Long recordId = 1L;
//        doNothing().when(foodRecordService).deleteFoodRecord(recordId);
//
//        // When & Then
//        mockMvc.perform(delete("/api/records/{id}", recordId))
//                .andExpect(status().isNoContent());
//    }
//
//    @Test
//    void shouldHandleValidationError() throws Exception {
//        // Given
//        FoodRecordDTO invalidRecord = new FoodRecordDTO();
//
//        // When & Then
//        mockMvc.perform(post("/api/records")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(invalidRecord)))
//                .andExpect(status().isBadRequest());
//    }
//
//    private FoodRecordDTO createFoodRecordDTO() {
//        return FoodRecordDTO.builder()
//            .userId(1L)
//            .foodName("Apple")
//            .calories(95)
//            .protein(0.5)
//            .carbohydrates(25.0)
//            .fat(0.3)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//}