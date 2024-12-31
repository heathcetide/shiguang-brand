package com.foodrecord.controller;//package com.foodrecord.controller;
//
//import com.foodrecord.dto.PreferenceDTO;
//import com.foodrecord.service.PreferenceService;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
//import org.springframework.boot.test.mock.mockito.MockBean;
//import org.springframework.http.MediaType;
//import org.springframework.test.web.servlet.MockMvc;
//import com.fasterxml.jackson.databind.ObjectMapper;
//import java.util.Arrays;
//import java.util.Map;
//
//import static org.mockito.Mockito.*;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@WebMvcTest(PreferenceController.class)
//class PreferenceControllerTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @Autowired
//    private ObjectMapper objectMapper;
//
//    @MockBean
//    private PreferenceService preferenceService;
//
//    @Test
//    void shouldUpdatePreferences() throws Exception {
//        // Given
//        Long userId = 1L;
//        PreferenceDTO preferenceDTO = createPreferenceDTO();
//        when(preferenceService.updatePreferences(eq(userId), any()))
//            .thenReturn(preferenceDTO);
//
//        // When & Then
//        mockMvc.perform(put("/api/preferences/{userId}", userId)
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(preferenceDTO)))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.calorieGoal").value(preferenceDTO.getCalorieGoal()));
//    }
//
//    @Test
//    void shouldGetUserPreferences() throws Exception {
//        // Given
//        Long userId = 1L;
//        when(preferenceService.getUserPreferences(userId))
//            .thenReturn(createPreferenceDTO());
//
//        // When & Then
//        mockMvc.perform(get("/api/preferences/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.dietaryRestrictions").exists());
//    }
//
//    @Test
//    void shouldUpdateMealReminders() throws Exception {
//        // Given
//        Long userId = 1L;
//        Map<String, String> mealTimes = Map.of(
//            "breakfast", "08:00",
//            "lunch", "12:30",
//            "dinner", "19:00"
//        );
//        when(preferenceService.updateMealReminders(eq(userId), any()))
//            .thenReturn(true);
//
//        // When & Then
//        mockMvc.perform(put("/api/preferences/{userId}/meal-reminders", userId)
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(mealTimes)))
//                .andExpect(status().isOk());
//    }
//
//    @Test
//    void shouldValidatePreferences() throws Exception {
//        // Given
//        PreferenceDTO invalidDTO = new PreferenceDTO();
//
//        // When & Then
//        mockMvc.perform(put("/api/preferences/1")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(invalidDTO)))
//                .andExpect(status().isBadRequest());
//    }
//
//    @Test
//    void shouldHandleUserNotFound() throws Exception {
//        // Given
//        Long userId = 999L;
//        when(preferenceService.getUserPreferences(userId))
//            .thenThrow(new UserNotFoundException("User not found"));
//
//        // When & Then
//        mockMvc.perform(get("/api/preferences/{userId}", userId))
//                .andExpect(status().isNotFound());
//    }
//
//    private PreferenceDTO createPreferenceDTO() {
//        return PreferenceDTO.builder()
//            .calorieGoal(2000)
//            .dietaryRestrictions(Arrays.asList("vegetarian", "gluten-free"))
//            .mealReminders(true)
//            .mealTimes(Map.of(
//                "breakfast", "08:00",
//                "lunch", "12:30",
//                "dinner", "19:00"
//            ))
//            .build();
//    }
//}