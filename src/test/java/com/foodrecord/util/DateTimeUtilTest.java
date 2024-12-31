package com.foodrecord.util;//package com.foodrecord.util;
//
//import org.junit.jupiter.api.Test;
//import java.time.LocalDateTime;
//import java.time.LocalDate;
//import java.time.temporal.ChronoUnit;
//
//import static org.assertj.core.api.Assertions.*;
//
//class DateTimeUtilTest {
//
//    @Test
//    void shouldGetStartOfDay() {
//        // Given
//        LocalDateTime dateTime = LocalDateTime.now();
//
//        // When
//        LocalDateTime startOfDay = DateTimeUtil.getStartOfDay(dateTime);
//
//        // Then
//        assertThat(startOfDay.getHour()).isZero();
//        assertThat(startOfDay.getMinute()).isZero();
//        assertThat(startOfDay.getSecond()).isZero();
//    }
//
//    @Test
//    void shouldGetEndOfDay() {
//        // Given
//        LocalDateTime dateTime = LocalDateTime.now();
//
//        // When
//        LocalDateTime endOfDay = DateTimeUtil.getEndOfDay(dateTime);
//
//        // Then
//        assertThat(endOfDay.getHour()).isEqualTo(23);
//        assertThat(endOfDay.getMinute()).isEqualTo(59);
//        assertThat(endOfDay.getSecond()).isEqualTo(59);
//    }
//
//    @Test
//    void shouldCalculateDateDifference() {
//        // Given
//        LocalDate date1 = LocalDate.now();
//        LocalDate date2 = date1.plusDays(5);
//
//        // When
//        long days = DateTimeUtil.getDaysBetween(date1, date2);
//
//        // Then
//        assertThat(days).isEqualTo(5);
//    }
//
//    @Test
//    void shouldCheckIfTimeIsInRange() {
//        // Given
//        LocalDateTime time = LocalDateTime.now();
//        LocalDateTime start = time.minusHours(1);
//        LocalDateTime end = time.plusHours(1);
//
//        // When
//        boolean isInRange = DateTimeUtil.isTimeInRange(time, start, end);
//
//        // Then
//        assertThat(isInRange).isTrue();
//    }
//
//    @Test
//    void shouldFormatDateTime() {
//        // Given
//        LocalDateTime dateTime = LocalDateTime.of(2024, 1, 1, 13, 30);
//
//        // When
//        String formatted = DateTimeUtil.formatDateTime(dateTime);
//
//        // Then
//        assertThat(formatted).isEqualTo("2024-01-01 13:30");
//    }
//
//    @Test
//    void shouldParseDateTime() {
//        // Given
//        String dateTimeStr = "2024-01-01 13:30";
//
//        // When
//        LocalDateTime parsed = DateTimeUtil.parseDateTime(dateTimeStr);
//
//        // Then
//        assertThat(parsed.getYear()).isEqualTo(2024);
//        assertThat(parsed.getMonthValue()).isEqualTo(1);
//        assertThat(parsed.getDayOfMonth()).isEqualTo(1);
//        assertThat(parsed.getHour()).isEqualTo(13);
//        assertThat(parsed.getMinute()).isEqualTo(30);
//    }
//
//    @Test
//    void shouldHandleInvalidDateFormat() {
//        // Given
//        String invalidDateTime = "invalid-date-time";
//
//        // When & Then
//        assertThatThrownBy(() -> DateTimeUtil.parseDateTime(invalidDateTime))
//            .isInstanceOf(IllegalArgumentException.class);
//    }
//}