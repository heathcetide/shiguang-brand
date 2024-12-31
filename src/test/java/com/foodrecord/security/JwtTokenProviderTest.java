package com.foodrecord.security;//package com.foodrecord.security;
//
//import com.foodrecord.config.JwtProperties;
//import io.jsonwebtoken.Claims;
//import org.junit.jupiter.api.BeforeEach;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import org.springframework.security.core.Authentication;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class JwtTokenProviderTest {
//
//    @Mock
//    private JwtProperties jwtProperties;
//
//    private JwtTokenProvider tokenProvider;
//
//    @BeforeEach
//    void setUp() {
//        when(jwtProperties.getSecret()).thenReturn("testSecretKeyWithMinimumLength32Chars");
//        when(jwtProperties.getExpirationInMs()).thenReturn(3600000L);
//        tokenProvider = new JwtTokenProvider(jwtProperties);
//    }
//
//    @Test
//    void shouldGenerateToken() {
//        // Given
//        Long userId = 1L;
//
//        // When
//        String token = tokenProvider.generateToken(userId);
//
//        // Then
//        assertThat(token).isNotEmpty();
//        assertThat(tokenProvider.validateToken(token)).isTrue();
//    }
//
//    @Test
//    void shouldGetUserIdFromToken() {
//        // Given
//        Long userId = 1L;
//        String token = tokenProvider.generateToken(userId);
//
//        // When
//        Long extractedUserId = tokenProvider.getUserIdFromToken(token);
//
//        // Then
//        assertThat(extractedUserId).isEqualTo(userId);
//    }
//
//    @Test
//    void shouldValidateToken() {
//        // Given
//        String token = tokenProvider.generateToken(1L);
//
//        // When
//        boolean isValid = tokenProvider.validateToken(token);
//
//        // Then
//        assertThat(isValid).isTrue();
//    }
//
//    @Test
//    void shouldHandleInvalidToken() {
//        // Given
//        String invalidToken = "invalid.token.here";
//
//        // When
//        boolean isValid = tokenProvider.validateToken(invalidToken);
//
//        // Then
//        assertThat(isValid).isFalse();
//    }
//
//    @Test
//    void shouldHandleExpiredToken() {
//        // Given
//        when(jwtProperties.getExpirationInMs()).thenReturn(0L);
//        String token = tokenProvider.generateToken(1L);
//
//        // When
//        boolean isValid = tokenProvider.validateToken(token);
//
//        // Then
//        assertThat(isValid).isFalse();
//    }
//
//    @Test
//    void shouldCreateAuthenticationFromToken() {
//        // Given
//        Long userId = 1L;
//        String token = tokenProvider.generateToken(userId);
//
//        // When
//        Authentication auth = tokenProvider.getAuthentication(token);
//
//        // Then
//        assertThat(auth).isNotNull();
//        assertThat(auth.getPrincipal()).isEqualTo(userId.toString());
//    }
//}