package com.foodrecord.repository;//package com.foodrecord.repository;
//
//import com.foodrecord.model.FoodRecord;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
//import org.springframework.test.context.jdbc.Sql;
//import java.time.LocalDateTime;
//import java.util.List;
//
//import static org.assertj.core.api.Assertions.*;
//
//@DataJpaTest
//class FoodRecordRepositoryTest {
//
//    @Autowired
//    private FoodRecordRepository foodRecordRepository;
//
//    @Test
//    @Sql("/scripts/insert_food_records.sql")
//    void shouldFindByUserId() {
//        // When
//        List<FoodRecord> records = foodRecordRepository.findByUserId(1L);
//
//        // Then
//        assertThat(records).isNotEmpty();
//        assertThat(records).allMatch(record -> record.getUserId().equals(1L));
//    }
//
//    @Test
//    void shouldSaveFoodRecord() {
//        // Given
//        FoodRecord record = createFoodRecord();
//
//        // When
//        FoodRecord saved = foodRecordRepository.save(record);
//
//        // Then
//        assertThat(saved.getId()).isNotNull();
//        assertThat(saved.getFoodName()).isEqualTo(record.getFoodName());
//    }
//
//    @Test
//    void shouldFindByDateRange() {
//        // Given
//        LocalDateTime start = LocalDateTime.now().minusDays(7);
//        LocalDateTime end = LocalDateTime.now();
//
//        // When
//        List<FoodRecord> records = foodRecordRepository
//            .findByUserIdAndRecordTimeBetween(1L, start, end);
//
//        // Then
//        assertThat(records).allMatch(record ->
//            record.getRecordTime().isAfter(start) &&
//            record.getRecordTime().isBefore(end));
//    }
//
//    private FoodRecord createFoodRecord() {
//        return FoodRecord.builder()
//            .userId(1L)
//            .foodName("Apple")
//            .calories(95)
//            .protein(0.5)
//            .carbohydrates(25.0)
//            .fat(0.3)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//}