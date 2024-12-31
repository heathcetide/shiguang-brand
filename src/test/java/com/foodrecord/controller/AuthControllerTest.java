package com.foodrecord.controller;//package com.foodrecord.controller;
//
//import com.foodrecord.dto.LoginRequestDTO;
//import com.foodrecord.dto.LoginResponseDTO;
//import com.foodrecord.dto.RegisterRequestDTO;
//import com.foodrecord.service.AuthService;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
//import org.springframework.boot.test.mock.mockito.MockBean;
//import org.springframework.http.MediaType;
//import org.springframework.test.web.servlet.MockMvc;
//import com.fasterxml.jackson.databind.ObjectMapper;
//
//import static org.mockito.Mockito.*;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@WebMvcTest(AuthController.class)
//class AuthControllerTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @Autowired
//    private ObjectMapper objectMapper;
//
//    @MockBean
//    private AuthService authService;
//
//    @Test
//    void shouldRegisterUser() throws Exception {
//        // Given
//        RegisterRequestDTO request = createRegisterRequest();
//        when(authService.register(any())).thenReturn(true);
//
//        // When & Then
//        mockMvc.perform(post("/api/auth/register")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(request)))
//                .andExpect(status().isCreated());
//    }
//
//    @Test
//    void shouldLoginUser() throws Exception {
//        // Given
//        LoginRequestDTO request = createLoginRequest();
//        LoginResponseDTO response = createLoginResponse();
//        when(authService.login(any())).thenReturn(response);
//
//        // When & Then
//        mockMvc.perform(post("/api/auth/login")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(request)))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.token").exists());
//    }
//
//    @Test
//    void shouldHandleInvalidCredentials() throws Exception {
//        // Given
//        LoginRequestDTO request = createLoginRequest();
//        when(authService.login(any()))
//            .thenThrow(new InvalidCredentialsException("Invalid credentials"));
//
//        // When & Then
//        mockMvc.perform(post("/api/auth/login")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(request)))
//                .andExpect(status().isUnauthorized());
//    }
//
//    @Test
//    void shouldValidateRegistrationRequest() throws Exception {
//        // Given
//        RegisterRequestDTO invalidRequest = new RegisterRequestDTO();
//
//        // When & Then
//        mockMvc.perform(post("/api/auth/register")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(invalidRequest)))
//                .andExpect(status().isBadRequest());
//    }
//
//    @Test
//    void shouldHandleEmailAlreadyExists() throws Exception {
//        // Given
//        RegisterRequestDTO request = createRegisterRequest();
//        when(authService.register(any()))
//            .thenThrow(new EmailAlreadyExistsException("Email already exists"));
//
//        // When & Then
//        mockMvc.perform(post("/api/auth/register")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(request)))
//                .andExpect(status().isConflict());
//    }
//
//    private RegisterRequestDTO createRegisterRequest() {
//        return RegisterRequestDTO.builder()
//            .email("test@example.com")
//            .password("password123")
//            .name("Test User")
//            .build();
//    }
//
//    private LoginRequestDTO createLoginRequest() {
//        return LoginRequestDTO.builder()
//            .email("test@example.com")
//            .password("password123")
//            .build();
//    }
//
//    private LoginResponseDTO createLoginResponse() {
//        return LoginResponseDTO.builder()
//            .token("jwt.token.here")
//            .userId(1L)
//            .email("test@example.com")
//            .build();
//    }
//}