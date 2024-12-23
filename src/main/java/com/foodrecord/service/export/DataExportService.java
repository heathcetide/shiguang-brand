package com.foodrecord.service.export;

import com.foodrecord.model.entity.*;
import com.foodrecord.model.entity.user.UserDietRecord;
import com.foodrecord.model.entity.user.UserDietStats;
import com.foodrecord.service.NutritionAnalysisService;
import com.foodrecord.service.impl.UserDietRecordServiceImpl;
import com.foodrecord.service.impl.UserDietStatsServiceImpl;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.time.LocalDate;
import java.util.List;

/**
 * 数据导出服务
 */
@Service
public class DataExportService {
    private final UserDietRecordServiceImpl dietRecordService;
    private final UserDietStatsServiceImpl dietStatsService;
    private final NutritionAnalysisService nutritionAnalysisService;

    public DataExportService(UserDietRecordServiceImpl dietRecordService, UserDietStatsServiceImpl dietStatsService, NutritionAnalysisService nutritionAnalysisService) {
        this.dietRecordService = dietRecordService;
        this.dietStatsService = dietStatsService;
        this.nutritionAnalysisService = nutritionAnalysisService;
    }

    /**
     * 导出用户饮食记录
     */
    public byte[] exportDietRecords(Long userId, LocalDate startDate, LocalDate endDate) {
        try (Workbook workbook = new XSSFWorkbook()) {
            // 1. 创建饮食记录sheet
            Sheet recordSheet = workbook.createSheet("饮食记录");
            createDietRecordSheet(recordSheet, userId, startDate, endDate);
            
            // 2. 创建营养统计sheet
            Sheet statsSheet = workbook.createSheet("营养统计");
            createNutritionStatsSheet(statsSheet, userId, startDate, endDate);
            
            // 3. 创建分析建议sheet
            Sheet analysisSheet = workbook.createSheet("分析建议");
            createAnalysisSheet(analysisSheet, userId);
            
            // 导出为字节数组
            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            workbook.write(outputStream);
            return outputStream.toByteArray();
        } catch (Exception e) {
            throw new RuntimeException("导出数据失败", e);
        }
    }
    
    /**
     * 创建饮食记录sheet
     */
    private void createDietRecordSheet(Sheet sheet, Long userId, LocalDate startDate, LocalDate endDate) {
        // 创建表头
        Row headerRow = sheet.createRow(0);
        String[] headers = {"日期", "餐次", "食物名称", "食用量(g)", "能量(kcal)", "蛋白质(g)", 
            "脂肪(g)", "碳水化合物(g)", "膳食纤维(g)"};
        for (int i = 0; i < headers.length; i++) {
            Cell cell = headerRow.createCell(i);
            cell.setCellValue(headers[i]);
        }
        
        // 获取数据
        List<UserDietRecord> records = dietRecordService.findByDateRange(userId, startDate, endDate);
        
        // 填充数据
        int rowNum = 1;
        for (UserDietRecord record : records) {
            Row row = sheet.createRow(rowNum++);
            row.createCell(0).setCellValue(record.getMealTime().toLocalDate().toString());
            row.createCell(1).setCellValue(record.getMealType());
            row.createCell(2).setCellValue(record.getFood().getName());
            row.createCell(3).setCellValue(record.getPortionSize());
            
//            // 计算营养素摄入量
//            Nutrition nutrition = record.getFood().getNutrition();
//            double ratio = record.getPortionSize() / 100.0;
//            row.createCell(4).setCellValue(nutrition.getCalory() * ratio);
//            row.createCell(5).setCellValue(nutrition.getProtein() * ratio);
//            row.createCell(6).setCellValue(nutrition.getFat() * ratio);
//            row.createCell(7).setCellValue(nutrition.getCarbohydrate() * ratio);
//            row.createCell(8).setCellValue(nutrition.getFiberDietary() * ratio);
        }
        
        // 自动调整列宽
        for (int i = 0; i < headers.length; i++) {
            sheet.autoSizeColumn(i);
        }
    }
    
    /**
     * 创建营养统计sheet
     */
    private void createNutritionStatsSheet(Sheet sheet, Long userId, LocalDate startDate, LocalDate endDate) {
        // 创建表头
        Row headerRow = sheet.createRow(0);
        String[] headers = {"日期", "总能量(kcal)", "早餐能量", "午餐能量", "晚餐能量", "零食能量",
            "蛋白质(g)", "脂肪(g)", "碳水化合物(g)", "膳食纤维(g)"};
        for (int i = 0; i < headers.length; i++) {
            Cell cell = headerRow.createCell(i);
            cell.setCellValue(headers[i]);
        }
        
        // 获取数据
        List<UserDietStats> statsList = dietStatsService.findByDateRange(userId, startDate, endDate);
        
        // 填充数据
        int rowNum = 1;
        for (UserDietStats stats : statsList) {
            Row row = sheet.createRow(rowNum++);
            row.createCell(0).setCellValue(stats.getStatsDate().toString());
            row.createCell(1).setCellValue(stats.getTotalCalory());
            row.createCell(2).setCellValue(stats.getBreakfastCalory());
            row.createCell(3).setCellValue(stats.getLunchCalory());
            row.createCell(4).setCellValue(stats.getDinnerCalory());
            row.createCell(5).setCellValue(stats.getSnackCalory());
            row.createCell(6).setCellValue(stats.getTotalProtein());
            row.createCell(7).setCellValue(stats.getTotalFat());
            row.createCell(8).setCellValue(stats.getTotalCarbohydrate());
            row.createCell(9).setCellValue(stats.getTotalFiber());
        }
        
        // 自动调整列宽
        for (int i = 0; i < headers.length; i++) {
            sheet.autoSizeColumn(i);
        }
    }
    
    /**
     * 创建分析建议sheet
     */
    private void createAnalysisSheet(Sheet sheet, Long userId) {
        // 获取最新的营养分析
        NutritionAnalysis analysis = nutritionAnalysisService.analyze(userId);
        
        // 创建营养素平衡分析
        Row headerRow = sheet.createRow(0);
        headerRow.createCell(0).setCellValue("营养素平衡分析");
        
        Row proteinRow = sheet.createRow(1);
        proteinRow.createCell(0).setCellValue("蛋白质");
        proteinRow.createCell(1).setCellValue(analysis.getProteinBalance());
        
        Row fatRow = sheet.createRow(2);
        fatRow.createCell(0).setCellValue("脂肪");
        fatRow.createCell(1).setCellValue(analysis.getFatBalance());
        
        Row carbRow = sheet.createRow(3);
        carbRow.createCell(0).setCellValue("碳水化合物");
        carbRow.createCell(1).setCellValue(analysis.getCarbBalance());
        
        // 创建改进建议
        Row suggestionHeader = sheet.createRow(5);
        suggestionHeader.createCell(0).setCellValue("改进建议");
        
        Row suggestion = sheet.createRow(6);
//        suggestion.createCell(0).setCellValue(analysis.getImprovementSuggestions());
        
        // 自动调整列宽
        sheet.autoSizeColumn(0);
        sheet.autoSizeColumn(1);
    }
    
    /**
     * 生成导入模板
     */
    public byte[] generateTemplate() {
        try (Workbook workbook = new XSSFWorkbook()) {
            // 1. 创建食物信息模板
            Sheet foodSheet = workbook.createSheet("食物信息");
            createFoodTemplateSheet(foodSheet);
            
            // 2. 创建饮食记录模板
            Sheet recordSheet = workbook.createSheet("饮食记录");
            createRecordTemplateSheet(recordSheet);
            
            // 3. 创建说明sheet
            Sheet instructionSheet = workbook.createSheet("填写说明");
            createInstructionSheet(instructionSheet);
            
            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            workbook.write(outputStream);
            return outputStream.toByteArray();
        } catch (Exception e) {
            throw new RuntimeException("生成模板失败", e);
        }
    }
    
    /**
     * 创建食物信息模板sheet
     */
    private void createFoodTemplateSheet(Sheet sheet) {
        // 创建表头
        Row headerRow = sheet.createRow(0);
        String[] headers = {
            "食物编码*", "食物名称*", "健康指数(1-5)*", "健康标签", "建议", 
            "能量(kcal)*", "蛋白质(g)*", "脂肪(g)*", "碳水化合物(g)*", "膳食纤维(g)*"
        };
        
        for (int i = 0; i < headers.length; i++) {
            Cell cell = headerRow.createCell(i);
            cell.setCellValue(headers[i]);
        }
        
        // 添加示例数据
        Row exampleRow = sheet.createRow(1);
        exampleRow.createCell(0).setCellValue("F001");
        exampleRow.createCell(1).setCellValue("鸡胸肉");
        exampleRow.createCell(2).setCellValue(5);
        exampleRow.createCell(3).setCellValue("高蛋白,低脂");
        exampleRow.createCell(4).setCellValue("适合健身人士");
        exampleRow.createCell(5).setCellValue(165);
        exampleRow.createCell(6).setCellValue(31);
        exampleRow.createCell(7).setCellValue(3.6);
        exampleRow.createCell(8).setCellValue(0);
        exampleRow.createCell(9).setCellValue(0);
        
        // 自动调整列宽
        for (int i = 0; i < headers.length; i++) {
            sheet.autoSizeColumn(i);
        }
    }
    
    /**
     * 创建饮食记录模板sheet
     */
    private void createRecordTemplateSheet(Sheet sheet) {
        // 创建表头
        Row headerRow = sheet.createRow(0);
        String[] headers = {
            "日期*", "时间*", "食物编码*", "食用量(g)*", "餐次*"
        };
        
        for (int i = 0; i < headers.length; i++) {
            Cell cell = headerRow.createCell(i);
            cell.setCellValue(headers[i]);
        }
        
        // 添加示例数据
        Row exampleRow = sheet.createRow(1);
        exampleRow.createCell(0).setCellValue("2024-01-01");
        exampleRow.createCell(1).setCellValue("12:00");
        exampleRow.createCell(2).setCellValue("F001");
        exampleRow.createCell(3).setCellValue(100);
        exampleRow.createCell(4).setCellValue("午餐");
        
        // 自动调整列宽
        for (int i = 0; i < headers.length; i++) {
            sheet.autoSizeColumn(i);
        }
    }
    
    /**
     * 创建说明sheet
     */
    private void createInstructionSheet(Sheet sheet) {
        int rowNum = 0;
        
        // 添加标题
        Row titleRow = sheet.createRow(rowNum++);
        titleRow.createCell(0).setCellValue("数据导入说明");
        
        // 添加通用说明
        rowNum = addInstructions(sheet, rowNum, "通用说明", new String[]{
            "1. 标记*的字段为必填项",
            "2. 请严格按照模板格式填写",
            "3. 日期格式：yyyy-MM-dd，如2024-01-01",
            "4. 时间格式：HH:mm，如12:00",
            "5. 数值类型请不要填写单位"
        });
        
        // 添加食物信息说明
        rowNum = addInstructions(sheet, rowNum + 1, "食物信息说明", new String[]{
            "1. 食物编码：唯一标识，建议使用F开头的编号",
            "2. 健康指数：1-5的整数，5表示最健康",
            "3. 健康标签：多个标签用逗号分隔",
            "4. 营养成分：以100g为单位"
        });
        
        // 添加饮食记录说明
        rowNum = addInstructions(sheet, rowNum + 1, "饮食记录说明", new String[]{
            "1. 食物编码必须在食物信息表中存在",
            "2. 餐次可选值：早餐、午餐、晚餐、加餐",
            "3. 食用量单位为克(g)"
        });
        
        // 自动调整列宽
        sheet.autoSizeColumn(0);
    }
    
    /**
     * 添加说明内容
     */
    private int addInstructions(Sheet sheet, int startRow, String title, String[] contents) {
        Row titleRow = sheet.createRow(startRow++);
        titleRow.createCell(0).setCellValue(title);
        
        for (String content : contents) {
            Row row = sheet.createRow(startRow++);
            row.createCell(0).setCellValue(content);
        }
        
        return startRow;
    }
} 