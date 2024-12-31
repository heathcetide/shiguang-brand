package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.LoginRequestDTO;
//import com.foodrecord.dto.LoginResponseDTO;
//import com.foodrecord.dto.RegisterRequestDTO;
//import com.foodrecord.model.User;
//import com.foodrecord.repository.UserRepository;
//import com.foodrecord.security.JwtTokenProvider;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import org.springframework.security.crypto.password.PasswordEncoder;
//import java.util.Optional;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class AuthServiceTest {
//
//    @Mock
//    private UserRepository userRepository;
//
//    @Mock
//    private PasswordEncoder passwordEncoder;
//
//    @Mock
//    private JwtTokenProvider tokenProvider;
//
//    @Mock
//    private EmailService emailService;
//
//    @InjectMocks
//    private AuthServiceImpl authService;
//
//    @Test
//    void shouldRegisterUser() {
//        // Given
//        RegisterRequestDTO request = createRegisterRequest();
//        when(userRepository.existsByEmail(request.getEmail())).thenReturn(false);
//        when(passwordEncoder.encode(request.getPassword())).thenReturn("encodedPassword");
//        when(userRepository.save(any())).thenReturn(createUser());
//
//        // When
//        boolean result = authService.register(request);
//
//        // Then
//        assertThat(result).isTrue();
//        verify(emailService).sendWelcomeEmail(request.getEmail(), request.getName());
//    }
//
//    @Test
//    void shouldLoginUser() {
//        // Given
//        LoginRequestDTO request = createLoginRequest();
//        User user = createUser();
//        when(userRepository.findByEmail(request.getEmail())).thenReturn(Optional.of(user));
//        when(passwordEncoder.matches(request.getPassword(), user.getPassword())).thenReturn(true);
//        when(tokenProvider.generateToken(user.getId())).thenReturn("jwt.token.here");
//
//        // When
//        LoginResponseDTO response = authService.login(request);
//
//        // Then
//        assertThat(response).isNotNull();
//        assertThat(response.getToken()).isNotEmpty();
//    }
//
//    @Test
//    void shouldHandleInvalidCredentials() {
//        // Given
//        LoginRequestDTO request = createLoginRequest();
//        when(userRepository.findByEmail(request.getEmail())).thenReturn(Optional.empty());
//
//        // When & Then
//        assertThatThrownBy(() -> authService.login(request))
//            .isInstanceOf(InvalidCredentialsException.class);
//    }
//
//    @Test
//    void shouldHandleEmailAlreadyExists() {
//        // Given
//        RegisterRequestDTO request = createRegisterRequest();
//        when(userRepository.existsByEmail(request.getEmail())).thenReturn(true);
//
//        // When & Then
//        assertThatThrownBy(() -> authService.register(request))
//            .isInstanceOf(EmailAlreadyExistsException.class);
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
//    private User createUser() {
//        return User.builder()
//            .id(1L)
//            .email("test@example.com")
//            .password("encodedPassword")
//            .name("Test User")
//            .build();
//    }
//}