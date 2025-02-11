package com.foodrecord.service.impl;

import com.foodrecord.model.dto.ImportResult;
import com.foodrecord.model.dto.ImportResultItem;
import com.foodrecord.model.entity.*;
import com.foodrecord.model.entity.UserDietRecord;
import com.foodrecord.service.DataImportService;
import com.foodrecord.service.FoodService;
import com.foodrecord.service.UserDietRecordService;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * 数据导入服务
 */
@Service
public class DataImportServiceImpl implements DataImportService {
    private final UserDietRecordService dietRecordService;
    private final FoodService foodService;
    private final NutritionServiceImpl nutritionService;

    public DataImportServiceImpl(UserDietRecordService dietRecordService, FoodService foodService, NutritionServiceImpl nutritionService) {
        this.dietRecordService = dietRecordService;
        this.foodService = foodService;
        this.nutritionService = nutritionService;
    }

    /**
     * 导入饮食记录
     */
    @Override
    @Transactional
    public ImportResult importDietRecords(Long userId, MultipartFile file) {
        ImportResult result = new ImportResult();
        
        try (InputStream is = file.getInputStream();
             Workbook workbook = new XSSFWorkbook(is)) {
            
            // 1. 导入食物基本信息
            Sheet foodSheet = workbook.getSheet("食物信息");
            if (foodSheet != null) {
                result.getFoodResults().addAll(importFoods(foodSheet));
            }
            
            // 2. 导入饮食记录
            Sheet recordSheet = workbook.getSheet("饮食记录");
            if (recordSheet != null) {
                result.getRecordResults().addAll(importRecords(userId, recordSheet));
            }
            
            return result;
        } catch (Exception e) {
            throw new RuntimeException("导入数据失败", e);
        }
    }
    
    /**
     * 导入食物信息
     */
    @Override
    public List<ImportResultItem> importFoods(Sheet sheet) {
        List<ImportResultItem> results = new ArrayList<>();
        int rowNum = 1; // 跳过表头
        
        while (rowNum <= sheet.getLastRowNum()) {
            Row row = sheet.getRow(rowNum++);
            if (isEmptyRow(row)) continue;
            
            try {
                // 解析食物基本信息
                Food food = new Food();
                food.setCode(getCellStringValue(row, 0));
                food.setName(getCellStringValue(row, 1));
                food.setHealthLight(getCellIntValue(row, 2));
                food.setHealthLabel(getCellStringValue(row, 3));
                food.setSuggest(getCellStringValue(row, 4));
                
                // 解析营养信息
                Nutrition nutrition = new Nutrition();
                nutrition.setCalory(getCellDoubleValue(row, 5));
                nutrition.setProtein(getCellDoubleValue(row, 6));
                nutrition.setFat(getCellDoubleValue(row, 7));
                nutrition.setCarbohydrate(getCellDoubleValue(row, 8));
                nutrition.setFiberDietary(getCellDoubleValue(row, 9));
                
                // 保存数据
                food = foodService.saveFood(food);
                nutrition.setFoodId(food.getId());
                nutritionService.save(nutrition);
                
                results.add(new ImportResultItem(rowNum, true, "导入成功"));
            } catch (Exception e) {
                results.add(new ImportResultItem(rowNum, false, e.getMessage()));
            }
        }
        
        return results;
    }
    
    /**
     * 导入饮食记录
     */
    @Override
    public List<ImportResultItem> importRecords(Long userId, Sheet sheet) {
        List<ImportResultItem> results = new ArrayList<>();
        int rowNum = 1; // 跳过表头
        
        while (rowNum <= sheet.getLastRowNum()) {
            Row row = sheet.getRow(rowNum++);
            if (isEmptyRow(row)) continue;
            
            try {
                UserDietRecord record = new UserDietRecord();
                record.setUserId(userId);
                
                // 解析日期和时间
                String dateStr = getCellStringValue(row, 0);
                String timeStr = getCellStringValue(row, 1);
                LocalDateTime mealTime = parseDateTime(dateStr, timeStr);
                record.setMealTime(mealTime);
                
                // 解析食物和用量
                String foodCode = getCellStringValue(row, 2);
                Food food = foodService.findByCode(foodCode);
                if (food == null) {
                    throw new RuntimeException("找不到食物编码: " + foodCode);
                }
                record.setFoodId(food.getId());
                record.setPortionSize(getCellDoubleValue(row, 3));
                record.setMealType(getCellStringValue(row, 4));
                
                // 保存记录
                dietRecordService.save(record);
                results.add(new ImportResultItem(rowNum, true, "导入成功"));
            } catch (Exception e) {
                results.add(new ImportResultItem(rowNum, false, e.getMessage()));
            }
        }
        
        return results;
    }
    
    /**
     * 检查是否为空行
     */
    @Override
    public boolean isEmptyRow(Row row) {
        if (row == null) return true;
        for (int i = 0; i < row.getLastCellNum(); i++) {
            Cell cell = row.getCell(i);
            if (cell != null && cell.getCellType() != CellType.BLANK) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * 获取单元格字符串值
     */
    @Override
    public String getCellStringValue(Row row, int colIndex) {
        Cell cell = row.getCell(colIndex);
        if (cell == null) return null;
        
        switch (cell.getCellType()) {
            case STRING:
                return cell.getStringCellValue();
            case NUMERIC:
                if (DateUtil.isCellDateFormatted(cell)) {
                    return cell.getLocalDateTimeCellValue().toString();
                }
                return String.valueOf(cell.getNumericCellValue());
            default:
                return null;
        }
    }
    
    /**
     * 获取单元格整数值
     */
    @Override
    public int getCellIntValue(Row row, int colIndex) {
        Cell cell = row.getCell(colIndex);
        if (cell == null) return 0;
        
        switch (cell.getCellType()) {
            case NUMERIC:
                return (int) cell.getNumericCellValue();
            case STRING:
                return Integer.parseInt(cell.getStringCellValue());
            default:
                return 0;
        }
    }
    
    /**
     * 获取单元格浮点值
     */
    @Override
    public float getCellDoubleValue(Row row, int colIndex) {
        Cell cell = row.getCell(colIndex);
        if (cell == null) return 0.0F;
        
        switch (cell.getCellType()) {
            case NUMERIC:
                return (float) cell.getNumericCellValue();
            case STRING:
                return (float) Double.parseDouble(cell.getStringCellValue());
            default:
                return 0.0F;
        }
    }
    
    /**
     * 解析日期时间
     */
    private LocalDateTime parseDateTime(String dateStr, String timeStr) {
        DateTimeFormatter dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");
        DateTimeFormatter timeFormatter = DateTimeFormatter.ofPattern("HH:mm");
        
        LocalDate date = LocalDate.parse(dateStr, dateFormatter);
        LocalTime time = LocalTime.parse(timeStr, timeFormatter);
        
        return LocalDateTime.of(date, time);
    }
} 