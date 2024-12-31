package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.UserDTO;
//import com.foodrecord.dto.UserProfileDTO;
//import com.foodrecord.model.User;
//import com.foodrecord.model.UserProfile;
//import com.foodrecord.repository.UserRepository;
//import com.foodrecord.repository.UserProfileRepository;
//import com.foodrecord.mapper.UserMapper;
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
//class UserServiceTest {
//
//    @Mock
//    private UserRepository userRepository;
//
//    @Mock
//    private UserProfileRepository profileRepository;
//
//    @Mock
//    private UserMapper userMapper;
//
//    @Mock
//    private PasswordEncoder passwordEncoder;
//
//    @InjectMocks
//    private UserServiceImpl userService;
//
//    @Test
//    void shouldCreateUser() {
//        // Given
//        UserDTO userDTO = createUserDTO();
//        User user = createUser();
//        when(userMapper.toEntity(any())).thenReturn(user);
//        when(userRepository.save(any())).thenReturn(user);
//        when(userMapper.toDTO(any())).thenReturn(userDTO);
//        when(passwordEncoder.encode(any())).thenReturn("encodedPassword");
//
//        // When
//        UserDTO result = userService.createUser(userDTO);
//
//        // Then
//        assertThat(result).isNotNull();
//        verify(userRepository).save(any());
//        verify(passwordEncoder).encode(userDTO.getPassword());
//    }
//
//    @Test
//    void shouldUpdateUserProfile() {
//        // Given
//        Long userId = 1L;
//        UserProfileDTO profileDTO = createUserProfileDTO();
//        User user = createUser();
//        UserProfile profile = createUserProfile();
//
//        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
//        when(profileRepository.save(any())).thenReturn(profile);
//        when(userMapper.toProfileDTO(any())).thenReturn(profileDTO);
//
//        // When
//        UserProfileDTO result = userService.updateUserProfile(userId, profileDTO);
//
//        // Then
//        assertThat(result).isNotNull();
//        verify(profileRepository).save(any());
//    }
//
//    @Test
//    void shouldThrowExceptionWhenUserNotFound() {
//        // Given
//        Long userId = 999L;
//        when(userRepository.findById(userId)).thenReturn(Optional.empty());
//
//        // When & Then
//        assertThatThrownBy(() -> userService.getUserProfile(userId))
//            .isInstanceOf(UserNotFoundException.class);
//    }
//
//    @Test
//    void shouldValidateEmailUniqueness() {
//        // Given
//        String email = "test@example.com";
//        when(userRepository.existsByEmail(email)).thenReturn(true);
//
//        // When & Then
//        assertThatThrownBy(() -> userService.validateEmailUniqueness(email))
//            .isInstanceOf(EmailAlreadyExistsException.class);
//    }
//
//    private UserDTO createUserDTO() {
//        return UserDTO.builder()
//            .email("test@example.com")
//            .name("Test User")
//            .password("password123")
//            .build();
//    }
//
//    private User createUser() {
//        return User.builder()
//            .id(1L)
//            .email("test@example.com")
//            .name("Test User")
//            .password("encodedPassword")
//            .build();
//    }
//
//    private UserProfileDTO createUserProfileDTO() {
//        return UserProfileDTO.builder()
//            .height(175.0)
//            .weight(70.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//
//    private UserProfile createUserProfile() {
//        return UserProfile.builder()
//            .id(1L)
//            .height(175.0)
//            .weight(70.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//}