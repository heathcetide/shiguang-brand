package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.FoodRecordDTO;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.time.LocalDateTime;
//import java.util.List;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class TimeValidatorTest {
//
//    @Mock
//    private TimeRangeProvider timeRangeProvider;
//
//    @InjectMocks
//    private TimeValidatorImpl timeValidator;
//
//    @Test
//    void shouldValidateValidTimeRecord() {
//        // Given
//        LocalDateTime now = LocalDateTime.now();
//        FoodRecordDTO recordDTO = createFoodRecordDTO(now);
//
//        // When
//        boolean isValid = timeValidator.validate(recordDTO);
//
//        // Then
//        assertThat(isValid).isTrue();
//        assertThat(timeValidator.getErrors(recordDTO)).isEmpty();
//    }
//
//    @Test
//    void shouldDetectFutureTime() {
//        // Given
//        LocalDateTime futureTime = LocalDateTime.now().plusDays(1);
//        FoodRecordDTO recordDTO = createFoodRecordDTO(futureTime);
//
//        // When
//        boolean isValid = timeValidator.validate(recordDTO);
//        List<String> errors = timeValidator.getErrors(recordDTO);
//
//        // Then
//        assertThat(isValid).isFalse();
//        assertThat(errors).contains("Record time cannot be in the future");
//    }
//
//    @Test
//    void shouldDetectTooOldRecord() {
//        // Given
//        LocalDateTime oldTime = LocalDateTime.now().minusYears(2);
//        FoodRecordDTO recordDTO = createFoodRecordDTO(oldTime);
//
//        when(timeRangeProvider.getMaxPastDays()).thenReturn(365);
//
//        // When
//        boolean isValid = timeValidator.validate(recordDTO);
//        List<String> errors = timeValidator.getErrors(recordDTO);
//
//        // Then
//        assertThat(isValid).isFalse();
//        assertThat(errors).contains("Record time is too old");
//    }
//
//    @Test
//    void shouldHandleMissingTime() {
//        // Given
//        FoodRecordDTO recordDTO = createFoodRecordDTO(null);
//
//        // When
//        boolean isValid = timeValidator.validate(recordDTO);
//        List<String> errors = timeValidator.getErrors(recordDTO);
//
//        // Then
//        assertThat(isValid).isFalse();
//        assertThat(errors).contains("Record time is required");
//    }
//
//    @Test
//    void shouldValidateTimeWithinMealWindow() {
//        // Given
//        LocalDateTime mealTime = LocalDateTime.now().withHour(12).withMinute(0);
//        FoodRecordDTO recordDTO = createFoodRecordDTO(mealTime);
//
//        when(timeRangeProvider.getMealWindows())
//            .thenReturn(createMealWindows());
//
//        // When
//        boolean isValid = timeValidator.validate(recordDTO);
//
//        // Then
//        assertThat(isValid).isTrue();
//        verify(timeRangeProvider).getMealWindows();
//    }
//
//    private FoodRecordDTO createFoodRecordDTO(LocalDateTime time) {
//        return FoodRecordDTO.builder()
//            .userId(1L)
//            .foodName("Test Food")
//            .calories(300)
//            .recordTime(time)
//            .build();
//    }
//
//    private Map<String, TimeRange> createMealWindows() {
//        return Map.of(
//            "breakfast", new TimeRange("06:00", "10:00"),
//            "lunch", new TimeRange("11:00", "14:00"),
//            "dinner", new TimeRange("17:00", "21:00")
//        );
//    }
//}