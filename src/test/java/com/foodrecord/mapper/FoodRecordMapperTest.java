package com.foodrecord.mapper;

//import com.foodrecord.dto.FoodRecordDTO;
//import com.foodrecord.model.FoodRecord;
import org.junit.jupiter.api.Test;
import org.mapstruct.factory.Mappers;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.*;

class FoodRecordMapperTest {

//    private final FoodRecordMapper mapper = Mappers.getMapper(FoodRecordMapper.class);
//
//    @Test
//    void shouldMapToDTO() {
//        // Given
//        FoodRecord entity = createFoodRecord();
//
//        // When
//        FoodRecordDTO dto = mapper.toDTO(entity);
//
//        // Then
//        assertThat(dto.getId()).isEqualTo(entity.getId());
//        assertThat(dto.getFoodName()).isEqualTo(entity.getFoodName());
//        assertThat(dto.getCalories()).isEqualTo(entity.getCalories());
//        assertThat(dto.getProtein()).isEqualTo(entity.getProtein());
//    }
//
//    @Test
//    void shouldMapToEntity() {
//        // Given
//        FoodRecordDTO dto = createFoodRecordDTO();
//
//        // When
//        FoodRecord entity = mapper.toEntity(dto);
//
//        // Then
//        assertThat(entity.getFoodName()).isEqualTo(dto.getFoodName());
//        assertThat(entity.getCalories()).isEqualTo(dto.getCalories());
//        assertThat(entity.getProtein()).isEqualTo(dto.getProtein());
//    }
//
//    @Test
//    void shouldHandleNullValues() {
//        // Given
//        FoodRecord entity = null;
//        FoodRecordDTO dto = null;
//
//        // When & Then
//        assertThat(mapper.toDTO(entity)).isNull();
//        assertThat(mapper.toEntity(dto)).isNull();
//    }
//
//    private FoodRecord createFoodRecord() {
//        return FoodRecord.builder()
//            .id(1L)
//            .userId(1L)
//            .foodName("Apple")
//            .calories(95)
//            .protein(0.5)
//            .carbohydrates(25.0)
//            .fat(0.3)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
//
//    private FoodRecordDTO createFoodRecordDTO() {
//        return FoodRecordDTO.builder()
//            .id(1L)
//            .userId(1L)
//            .foodName("Apple")
//            .calories(95)
//            .protein(0.5)
//            .carbohydrates(25.0)
//            .fat(0.3)
//            .recordTime(LocalDateTime.now())
//            .build();
//    }
}