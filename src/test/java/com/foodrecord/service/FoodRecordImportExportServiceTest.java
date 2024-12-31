package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.repository.FoodRecordRepository;
//import com.foodrecord.model.FoodRecord;
//import com.foodrecord.dto.ExportDTO;
//import com.foodrecord.dto.ImportDTO;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.time.LocalDateTime;
//import java.util.Arrays;
//import java.util.List;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class FoodRecordImportExportServiceTest {
//
//    @Mock
//    private FoodRecordRepository recordRepository;
//
//    @Mock
//    private DataValidator dataValidator;
//
//    @Mock
//    private FileFormatConverter formatConverter;
//
//    @InjectMocks
//    private FoodRecordImportExportServiceImpl importExportService;
//
//    @Test
//    void shouldExportFoodRecordsToCSV() {
//        // Given
//        Long userId = 1L;
//        LocalDateTime startDate = LocalDateTime.now().minusDays(7);
//        LocalDateTime endDate = LocalDateTime.now();
//
//        List<FoodRecord> records = Arrays.asList(
//            createTestRecord(1L, "Breakfast", 300),
//            createTestRecord(2L, "Lunch", 500)
//        );
//
//        when(recordRepository.findByUserIdAndDateRange(userId, startDate, endDate))
//            .thenReturn(records);
//        when(formatConverter.convertToCSV(any())).thenReturn("csv content");
//
//        // When
//        ExportDTO result = importExportService.exportToCSV(userId, startDate, endDate);
//
//        // Then
//        assertThat(result.getContent()).isNotEmpty();
//        assertThat(result.getRecordCount()).isEqualTo(2);
//        verify(formatConverter).convertToCSV(records);
//    }
//
//    @Test
//    void shouldImportFoodRecordsFromCSV() {
//        // Given
//        Long userId = 1L;
//        String csvContent = "date,food,calories\n2024-01-01,Apple,95";
//        List<FoodRecord> parsedRecords = Arrays.asList(
//            createTestRecord(null, "Apple", 95)
//        );
//
//        when(formatConverter.parseFromCSV(csvContent)).thenReturn(parsedRecords);
//        when(dataValidator.validateImportedRecords(any())).thenReturn(true);
//        when(recordRepository.saveAll(any())).thenReturn(parsedRecords);
//
//        // When
//        ImportDTO result = importExportService.importFromCSV(userId, csvContent);
//
//        // Then
//        assertThat(result.getSuccessCount()).isEqualTo(1);
//        assertThat(result.getFailureCount()).isZero();
//        verify(recordRepository).saveAll(any());
//    }
//
//    @Test
//    void shouldHandleInvalidImportData() {
//        // Given
//        Long userId = 1L;
//        String invalidContent = "invalid,csv,content";
//
//        when(formatConverter.parseFromCSV(invalidContent))
//            .thenThrow(new InvalidFormatException("Invalid CSV format"));
//
//        // When & Then
//        assertThatThrownBy(() ->
//            importExportService.importFromCSV(userId, invalidContent))
//            .isInstanceOf(InvalidFormatException.class);
//
//        verify(recordRepository, never()).saveAll(any());
//    }
//
//    @Test
//    void shouldValidateDataBeforeImport() {
//        // Given
//        Long userId = 1L;
//        String csvContent = "date,food,calories\n2024-01-01,Apple,-95";
//        List<FoodRecord> invalidRecords = Arrays.asList(
//            createTestRecord(null, "Apple", -95)
//        );
//
//        when(formatConverter.parseFromCSV(csvContent)).thenReturn(invalidRecords);
//        when(dataValidator.validateImportedRecords(any())).thenReturn(false);
//
//        // When
//        ImportDTO result = importExportService.importFromCSV(userId, csvContent);
//
//        // Then
//        assertThat(result.getSuccessCount()).isZero();
//        assertThat(result.getFailureCount()).isEqualTo(1);
//        verify(recordRepository, never()).saveAll(any());
//    }
//
//    private FoodRecord createTestRecord(Long id, String name, int calories) {
//        FoodRecord record = new FoodRecord();
//        record.setId(id);
//        record.setFoodName(name);
//        record.setCalories(calories);
//        record.setRecordTime(LocalDateTime.now());
//        return record;
//    }
//}