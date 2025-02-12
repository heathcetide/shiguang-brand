package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.ImportResult;
import com.foodrecord.service.DataImportService;
import com.foodrecord.service.export.DataExportService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * 数据导入导出控制器
 */
@RestController
@RequestMapping("/api/data")
@Api(tags = "数据导入导出")
public class DataImportExportController {

    private final DataImportService importService;
    private final DataExportService exportService;

    public DataImportExportController(DataImportService importService, DataExportService exportService) {
        this.importService = importService;
        this.exportService = exportService;
    }

    /**
     * 导入饮食记录
     */
    @PostMapping("/import")
    @ApiOperation("导入饮食记录")
    public ApiResponse<ImportResult> importData(
            @RequestParam("userId") Long userId,
            @RequestParam("file") MultipartFile file) {
        try {
            ImportResult result = importService.importDietRecords(userId, file);
            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error(500,"导入失败: " + e.getMessage());
        }
    }
    
    /**
     * 导出饮食记录
     */
    @GetMapping("/export")
    @ApiOperation("导出饮食记录")
    public ResponseEntity<ByteArrayResource> exportData(
            @RequestParam("userId") Long userId,
            @RequestParam(value = "startDate", required = false) String startDate,
            @RequestParam(value = "endDate", required = false) String endDate) {
        try {
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");
            LocalDate start = startDate != null ? LocalDate.parse(startDate, formatter) : 
                LocalDate.now().minusMonths(1);
            LocalDate end = endDate != null ? LocalDate.parse(endDate, formatter) : 
                LocalDate.now();
            
            byte[] data = exportService.exportDietRecords(userId, start, end);
            ByteArrayResource resource = new ByteArrayResource(data);
            
            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, 
                    "attachment;filename=diet_records_" + userId + ".xlsx")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(data.length)
                .body(resource);
        } catch (Exception e) {
            throw new RuntimeException("导出失败: " + e.getMessage());
        }
    }
    
    /**
     * 获取导入模板
     */
    @GetMapping("/template")
    @ApiOperation("获取导入模板")
    public ResponseEntity<ByteArrayResource> getTemplate() {
        try {
            byte[] data = exportService.generateTemplate();
            ByteArrayResource resource = new ByteArrayResource(data);
            
            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, 
                    "attachment;filename=import_template.xlsx")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(data.length)
                .body(resource);
        } catch (Exception e) {
            throw new RuntimeException("获取模板失败: " + e.getMessage());
        }
    }
} 