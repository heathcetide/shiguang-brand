package com.foodrecord.repository;//package com.foodrecord.repository;
//
//import com.foodrecord.model.User;
//import com.foodrecord.model.UserProfile;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
//import org.springframework.test.context.jdbc.Sql;
//import java.util.Optional;
//
//import static org.assertj.core.api.Assertions.*;
//
//@DataJpaTest
//class UserRepositoryTest {
//
//    @Autowired
//    private UserRepository userRepository;
//
//    @Test
//    @Sql("/scripts/insert_users.sql")
//    void shouldFindByEmail() {
//        // When
//        Optional<User> user = userRepository.findByEmail("test@example.com");
//
//        // Then
//        assertThat(user).isPresent();
//        assertThat(user.get().getEmail()).isEqualTo("test@example.com");
//    }
//
//    @Test
//    void shouldSaveUser() {
//        // Given
//        User user = createUser();
//
//        // When
//        User saved = userRepository.save(user);
//
//        // Then
//        assertThat(saved.getId()).isNotNull();
//        assertThat(saved.getEmail()).isEqualTo(user.getEmail());
//    }
//
//    @Test
//    void shouldCheckEmailExists() {
//        // Given
//        User user = createUser();
//        userRepository.save(user);
//
//        // When
//        boolean exists = userRepository.existsByEmail(user.getEmail());
//
//        // Then
//        assertThat(exists).isTrue();
//    }
//
//    @Test
//    void shouldFindUserWithProfile() {
//        // Given
//        User user = createUserWithProfile();
//        userRepository.save(user);
//
//        // When
//        Optional<User> found = userRepository.findById(user.getId());
//
//        // Then
//        assertThat(found).isPresent();
//        assertThat(found.get().getProfile()).isNotNull();
//        assertThat(found.get().getProfile().getHeight()).isEqualTo(user.getProfile().getHeight());
//    }
//
//    private User createUser() {
//        return User.builder()
//            .email("test@example.com")
//            .password("encodedPassword")
//            .name("Test User")
//            .build();
//    }
//
//    private User createUserWithProfile() {
//        User user = createUser();
//        UserProfile profile = UserProfile.builder()
//            .height(175.0)
//            .weight(70.0)
//            .age(30)
//            .activityLevel(ActivityLevel.MODERATE)
//            .build();
//        user.setProfile(profile);
//        profile.setUser(user);
//        return user;
//    }
//}