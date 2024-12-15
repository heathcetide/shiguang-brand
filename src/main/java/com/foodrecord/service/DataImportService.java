package com.foodrecord.service;

import com.foodrecord.model.dto.ImportResult;
import com.foodrecord.model.dto.ImportResultItem;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

public interface DataImportService {
    List<ImportResultItem> importFoods(Sheet sheet);

    ImportResult importDietRecords(Long userId, MultipartFile file);

    List<ImportResultItem> importRecords(Long userId, Sheet sheet);

    boolean isEmptyRow(Row row);

    String getCellStringValue(Row row, int colIndex);

    int getCellIntValue(Row row, int colIndex);

    float getCellDoubleValue(Row row, int colIndex);
}
