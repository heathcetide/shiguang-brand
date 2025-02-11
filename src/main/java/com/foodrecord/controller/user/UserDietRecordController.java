package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.UserDietRecordDTO;
import com.foodrecord.model.entity.UserDietRecord;
import com.foodrecord.service.UserDietRecordService;
import io.swagger.annotations.Api;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/diet-records")
@Api(tags = "饮食记录模块")
public class UserDietRecordController {

    @Resource
    private UserDietRecordService dietRecordService;


    /**
     * 分页获取用户的饮食记录
     * @param userId 用户ID
     * @param pageable 分页参数
     * @return 分页后的饮食记录列表
     */
    @GetMapping("/user/{userId}")
    public ApiResponse<Page<UserDietRecord>> getUserDietRecords(
            @PathVariable Long userId,
            Pageable pageable) {
        return ApiResponse.success((Page<UserDietRecord>) dietRecordService.getUserDietRecords(userId, pageable));
    }

    /**
     * 根据日期范围获取用户的饮食记录
     * @param userId 用户ID
     * @param startTime 开始时间
     * @param endTime 结束时间
     * @return 指定日期范围内的饮食记录列表
     */
    @GetMapping("/user/{userId}/date-range")
    public ApiResponse<List<UserDietRecord>> getUserDietRecordsByDateRange(
            @PathVariable Long userId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startTime,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endTime) {
        return ApiResponse.success(
            dietRecordService.getUserDietRecordsByDateRange(userId, startTime, endTime)
        );
    }

    /**
     * 创建新的饮食记录
     * @param userId 用户ID
     * @param dietRecordDTO 饮食记录信息
     * @return 创建成功的饮食记录
     */
    @PostMapping("/user/{userId}")
    public ApiResponse<UserDietRecord> createDietRecord(
            @PathVariable Long userId,
            @Valid @RequestBody UserDietRecordDTO dietRecordDTO) {
        return ApiResponse.success(dietRecordService.createDietRecord(userId, dietRecordDTO));
    }

    /**
     * 更新指定的饮食记录
     * @param userId 用户ID
     * @param recordId 记录ID
     * @param dietRecordDTO 更新的饮食记录信息
     * @return 更新后的饮食记录
     */
    @PutMapping("/user/{userId}/record/{recordId}")
    public ApiResponse<UserDietRecord> updateDietRecord(
            @PathVariable Long userId,
            @PathVariable Long recordId,
            @Valid @RequestBody UserDietRecordDTO dietRecordDTO) {
        return ApiResponse.success(
            dietRecordService.updateDietRecord(userId, recordId, dietRecordDTO)
        );
    }

    /**
     * 删除指定的饮食记录
     * @param userId 用户ID
     * @param recordId 记录ID
     * @return 无返回内容
     */
    @DeleteMapping("/user/{userId}/record/{recordId}")
    public ApiResponse<Void> deleteDietRecord(
            @PathVariable Long userId,
            @PathVariable Long recordId) {
        dietRecordService.deleteDietRecord(userId, recordId);
        return ApiResponse.success(null);
    }

    /**
     * 根据餐食类型获取用户的饮食记录
     * @param userId 用户ID
     * @param mealType 餐食类型（早餐/午餐/晚餐/加餐）
     * @return 指定餐食类型的饮食记录列表
     */
    @GetMapping("/user/{userId}/meal-type/{mealType}")
    public ApiResponse<List<UserDietRecord>> getUserDietRecordsByMealType(
            @PathVariable Long userId,
            @PathVariable String mealType) {
        return ApiResponse.success(
            dietRecordService.findByUserIdAndMealType(userId, mealType)
        );
    }
} 