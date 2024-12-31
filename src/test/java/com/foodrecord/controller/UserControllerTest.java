package com.foodrecord.controller;

import com.foodrecord.controller.user.UserController;
//import com.foodrecord.dto.UserDTO;
//import com.foodrecord.dto.UserProfileDTO;
import com.foodrecord.service.UserService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import com.fasterxml.jackson.databind.ObjectMapper;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(UserController.class)
class UserControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private UserService userService;

//    @Test
//    void shouldGetUser() throws Exception {
//        // Given
//        Long userId = 1L;
//        UserDTO userDTO = createUserDTO();
//        when(userService.getUser(userId)).thenReturn(userDTO);
//
//        // When & Then
//        mockMvc.perform(get("/api/users/{id}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.email").value(userDTO.getEmail()));
//    }
//
//    @Test
//    void shouldUpdateUserProfile() throws Exception {
//        // Given
//        Long userId = 1L;
//        UserProfileDTO profileDTO = createUserProfileDTO();
//        when(userService.updateUserProfile(eq(userId), any()))
//            .thenReturn(profileDTO);
//
//        // When & Then
//        mockMvc.perform(put("/api/users/{id}/profile", userId)
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(profileDTO)))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.height").value(profileDTO.getHeight()));
//    }
//
//    @Test
//    void shouldChangePassword() throws Exception {
//        // Given
//        Long userId = 1L;
//        PasswordChangeDTO request = createPasswordChangeDTO();
//        doNothing().when(userService).changePassword(eq(userId), any());
//
//        // When & Then
//        mockMvc.perform(post("/api/users/{id}/change-password", userId)
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(request)))
//                .andExpect(status().isOk());
//    }
//
//    @Test
//    void shouldHandleUserNotFound() throws Exception {
//        // Given
//        Long userId = 999L;
//        when(userService.getUser(userId))
//            .thenThrow(new UserNotFoundException("User not found"));
//
//        // When & Then
//        mockMvc.perform(get("/api/users/{id}", userId))
//                .andExpect(status().isNotFound());
//    }
//
//    private UserDTO createUserDTO() {
//        return UserDTO.builder()
//            .id(1L)
//            .email("test@example.com")
//            .name("Test User")
//            .build();
//    }
//
//    private UserProfileDTO createUserProfileDTO() {
//        return UserProfileDTO.builder()
//            .height(175.0)
//            .weight(70.0)
//            .age(30)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//
//    private PasswordChangeDTO createPasswordChangeDTO() {
//        return PasswordChangeDTO.builder()
//            .currentPassword("oldPassword")
//            .newPassword("newPassword")
//            .build();
//    }
}
