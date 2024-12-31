package com.foodrecord.validator;//package com.foodrecord.validator;
//
//import com.foodrecord.dto.UserProfileDTO;
//import com.foodrecord.model.ActivityLevel;
//import com.foodrecord.model.Gender;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.List;
//
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class UserProfileValidatorTest {
//
//    @InjectMocks
//    private UserProfileValidator validator;
//
//    @Test
//    void shouldValidateValidProfile() {
//        // Given
//        UserProfileDTO profile = createValidProfile();
//
//        // When
//        List<String> errors = validator.validate(profile);
//
//        // Then
//        assertThat(errors).isEmpty();
//    }
//
//    @Test
//    void shouldValidateInvalidAge() {
//        // Given
//        UserProfileDTO profile = createProfileWithInvalidAge();
//
//        // When
//        List<String> errors = validator.validate(profile);
//
//        // Then
//        assertThat(errors).contains("Age must be between 13 and 120");
//    }
//
//    @Test
//    void shouldValidateInvalidWeight() {
//        // Given
//        UserProfileDTO profile = createProfileWithInvalidWeight();
//
//        // When
//        List<String> errors = validator.validate(profile);
//
//        // Then
//        assertThat(errors).contains("Weight must be between 30 and 300 kg");
//    }
//
//    @Test
//    void shouldValidateInvalidHeight() {
//        // Given
//        UserProfileDTO profile = createProfileWithInvalidHeight();
//
//        // When
//        List<String> errors = validator.validate(profile);
//
//        // Then
//        assertThat(errors).contains("Height must be between 100 and 250 cm");
//    }
//
//    @Test
//    void shouldValidateNullFields() {
//        // Given
//        UserProfileDTO profile = new UserProfileDTO();
//
//        // When
//        List<String> errors = validator.validate(profile);
//
//        // Then
//        assertThat(errors).contains(
//            "Gender is required",
//            "Age is required",
//            "Weight is required",
//            "Height is required",
//            "Activity level is required"
//        );
//    }
//
//    private UserProfileDTO createValidProfile() {
//        return UserProfileDTO.builder()
//            .gender(Gender.MALE)
//            .age(30)
//            .weight(75.0)
//            .height(180.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//
//    private UserProfileDTO createProfileWithInvalidAge() {
//        return UserProfileDTO.builder()
//            .gender(Gender.MALE)
//            .age(10)
//            .weight(75.0)
//            .height(180.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//
//    private UserProfileDTO createProfileWithInvalidWeight() {
//        return UserProfileDTO.builder()
//            .gender(Gender.MALE)
//            .age(30)
//            .weight(20.0)
//            .height(180.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//
//    private UserProfileDTO createProfileWithInvalidHeight() {
//        return UserProfileDTO.builder()
//            .gender(Gender.MALE)
//            .age(30)
//            .weight(75.0)
//            .height(90.0)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//    }
//}