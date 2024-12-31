package com.foodrecord.mapper;

//import com.foodrecord.dto.UserDTO;
//import com.foodrecord.dto.UserProfileDTO;
//import com.foodrecord.model.User;
//import com.foodrecord.model.UserProfile;
import org.junit.jupiter.api.Test;
import org.mapstruct.factory.Mappers;

import static org.assertj.core.api.Assertions.*;

class UserMapperTest {

//    private final UserMapper mapper = Mappers.getMapper(UserMapper.class);
//
//    @Test
//    void shouldMapToDTO() {
//        // Given
//        User entity = createUser();
//
//        // When
//        UserDTO dto = mapper.toDTO(entity);
//
//        // Then
//        assertThat(dto.getId()).isEqualTo(entity.getId());
//        assertThat(dto.getEmail()).isEqualTo(entity.getEmail());
//        assertThat(dto.getName()).isEqualTo(entity.getName());
//    }
//
//    @Test
//    void shouldMapToEntity() {
//        // Given
//        UserDTO dto = createUserDTO();
//
//        // When
//        User entity = mapper.toEntity(dto);
//
//        // Then
//        assertThat(entity.getEmail()).isEqualTo(dto.getEmail());
//        assertThat(entity.getName()).isEqualTo(dto.getName());
//    }
//
//    @Test
//    void shouldMapProfileToDTO() {
//        // Given
//        UserProfile profile = createUserProfile();
//
//        // When
//        UserProfileDTO dto = mapper.profileToDTO(profile);
//
//        // Then
//        assertThat(dto.getHeight()).isEqualTo(profile.getHeight());
//        assertThat(dto.getWeight()).isEqualTo(profile.getWeight());
//        assertThat(dto.getAge()).isEqualTo(profile.getAge());
//        assertThat(dto.getActivityLevel()).isEqualTo(profile.getActivityLevel());
//    }
//
//    @Test
//    void shouldMapProfileToEntity() {
//        // Given
//        UserProfileDTO dto = createUserProfileDTO();
//
//        // When
//        UserProfile entity = mapper.profileToEntity(dto);
//
//        // Then
//        assertThat(entity.getHeight()).isEqualTo(dto.getHeight());
//        assertThat(entity.getWeight()).isEqualTo(dto.getWeight());
//        assertThat(entity.getAge()).isEqualTo(dto.getAge());
//        assertThat(entity.getActivityLevel()).isEqualTo(dto.getActivityLevel());
//    }
//
//    private User createUser() {
//        return User.builder()
//            .id(1L)
//            .email("test@example.com")
//            .password("encodedPassword")
//            .name("Test User")
//            .profile(createUserProfile())
//            .build();
//    }
//
//    private UserDTO createUserDTO() {
//        return UserDTO.builder()
//            .id(1L)
//            .email("test@example.com")
//            .name("Test User")
//            .profile(createUserProfileDTO())
//            .build();
//    }
//
//    private UserProfile createUserProfile() {
//        return UserProfile.builder()
//            .height(175.0)
//            .weight(70.0)
//            .age(30)
//            .activityLevel(ActivityLevel.MODERATE)
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
}