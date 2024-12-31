package com.foodrecord.exception;

import com.foodrecord.controller.user.UserController;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;
//import org.springframework.web.bind.MethodArgumentNotValidException;
//import org.springframework.security.access.AccessDeniedException;
//import org.springframework.security.authentication.BadCredentialsException;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(UserController.class)
class GlobalExceptionHandlerTest {

//    @Autowired
//    private MockMvc mockMvc;
//
//    @MockBean
//    private UserService userService;
//
//    @Test
//    void shouldHandleUserNotFoundException() throws Exception {
//        // Given
//        when(userService.getUser(999L))
//            .thenThrow(new UserNotFoundException("User not found"));
//
//        // When & Then
//        mockMvc.perform(get("/api/users/999"))
//                .andExpect(status().isNotFound())
//                .andExpect(jsonPath("$.message").value("User not found"))
//                .andExpect(jsonPath("$.status").value(404));
//    }
//
//    @Test
//    void shouldHandleValidationException() throws Exception {
//        // Given
//        UserDTO invalidUser = new UserDTO(); // Missing required fields
//
//        // When & Then
//        mockMvc.perform(post("/api/users")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(new ObjectMapper().writeValueAsString(invalidUser)))
//                .andExpect(status().isBadRequest())
//                .andExpect(jsonPath("$.errors").exists());
//    }
//
//    @Test
//    void shouldHandleAccessDeniedException() throws Exception {
//        // Given
//        when(userService.deleteUser(1L))
//            .thenThrow(new AccessDeniedException("Access denied"));
//
//        // When & Then
//        mockMvc.perform(delete("/api/users/1"))
//                .andExpect(status().isForbidden())
//                .andExpect(jsonPath("$.message").value("Access denied"));
//    }
//
//    @Test
//    void shouldHandleBadCredentialsException() throws Exception {
//        // Given
//        when(userService.authenticateUser(any()))
//            .thenThrow(new BadCredentialsException("Invalid credentials"));
//
//        // When & Then
//        mockMvc.perform(post("/api/users/authenticate")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content("{\"username\":\"test\",\"password\":\"wrong\"}"))
//                .andExpect(status().isUnauthorized())
//                .andExpect(jsonPath("$.message").value("Invalid credentials"));
//    }
//
//    @Test
//    void shouldHandleMethodArgumentTypeMismatch() throws Exception {
//        // When & Then
//        mockMvc.perform(get("/api/users/invalid-id"))
//                .andExpect(status().isBadRequest())
//                .andExpect(jsonPath("$.message").exists());
//    }
//
//    @Test
//    void shouldHandleHttpRequestMethodNotSupported() throws Exception {
//        // When & Then
//        mockMvc.perform(patch("/api/users/1"))
//                .andExpect(status().isMethodNotAllowed())
//                .andExpect(jsonPath("$.message").exists());
//    }
//
//    @Test
//    void shouldHandleGenericException() throws Exception {
//        // Given
//        when(userService.getUser(1L))
//            .thenThrow(new RuntimeException("Unexpected error"));
//
//        // When & Then
//        mockMvc.perform(get("/api/users/1"))
//                .andExpect(status().isInternalServerError())
//                .andExpect(jsonPath("$.message").value("Internal server error"));
//    }
} 