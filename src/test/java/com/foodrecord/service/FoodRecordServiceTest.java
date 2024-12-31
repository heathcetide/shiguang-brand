package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.FoodRecordDTO;
//import com.foodrecord.model.FoodRecord;
//import com.foodrecord.repository.FoodRecordRepository;
//import com.foodrecord.mapper.FoodRecordMapper;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.time.LocalDateTime;
//import java.util.Arrays;
//import java.util.List;
//import java.util.Optional;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class FoodRecordServiceTest {
//
//    @Mock
//    private FoodRecordRepository recordRepository;
//
//    @Mock
//    private FoodRecordMapper recordMapper;
//
//    @Mock
//    private TimeValidator timeValidator;
//
//    @InjectMocks
//    private FoodRecordServiceImpl recordService;
//
//    @Test
//    void shouldCreateFoodRecord() {
//        // Given
//        FoodRecordDTO recordDTO = createFoodRecordDTO();
//        FoodRecord record = createFoodRecord();
//        when(timeValidator.validate(any())).thenReturn(true);
//        when(recordMapper.toEntity(any())).thenReturn(record);
//        when(recordRepository.save(any())).thenReturn(record);
//        when(recordMapper.toDTO(any())).thenReturn(recordDTO);
//
//        // When
//        FoodRecordDTO result = recordService.createFoodRecord(recordDTO);
//
//        // Then
//        assertThat(result).isNotNull();
//        verify(recordRepository).save(any());
//    }
//
//    @Test
//    void shouldGetUserFoodRecords() {
//        // Given
//        Long userId = 1L;
//        List<FoodRecord> records = Arrays.asList(createFoodRecord(), createFoodRecord());
//        when(recordRepository.findByUserIdOrderByRecordTimeDesc(userId))
//            .thenReturn(records);
//        when(recordMapper.toDTO(any())).thenReturn(createFoodRecordDTO());
//
//        // When
//        List<FoodRecordDTO> results = recordService.getUserFoodRecords(userId);
//
//        // Then
//        assertThat(results).hasSize(2);
//    }
//
//    @Test
//    void shouldUpdateFoodRecord() {
//        // Given
//        Long recordId = 1L;
//        FoodRecordDTO updateDTO = createFoodRecordDTO();
//        FoodRecord existingRecord = createFoodRecord();
//        when(recordRepository.findById(recordId))
//            .thenReturn(Optional.of(existingRecord));
//        when(timeValidator.validate(any())).thenReturn(true);
//        when(recordRepository.save(any())).thenReturn(existingRecord);
//        when(recordMapper.toDTO(any())).thenReturn(updateDTO);
//
//        // When
//        FoodRecordDTO result = recordService.updateFoodRecord(recordId, updateDTO);
//
//        // Then
//        assertThat(result).isNotNull();
//        verify(recordRepository).save(any());
//    }
//
//    @Test
//    void shouldValidateTimeBeforeCreating() {
//        // Given
//        FoodRecordDTO recordDTO = createFoodRecordDTO();
//        when(timeValidator.validate(any())).thenReturn(false);
//        when(timeValidator.getErrors(any()))
//            .thenReturn(Arrays.asList("Invalid time"));
//
//        // When & Then
//        assertThatThrownBy(() -> recordService.createFoodRecord(recordDTO))
//            .isInstanceOf(InvalidRecordTimeException.class);
//
//        verify(recordRepository, never()).save(any());
//    }
//
//    private FoodRecordDTO createFoodRecordDTO() {
//        return FoodRecordDTO.builder()
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
//}