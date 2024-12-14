package com.foodrecord.controller;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.NotificationDTO;
import com.foodrecord.model.dto.NotificationQuery;
import com.foodrecord.model.dto.NotificationRequest;
import com.foodrecord.model.entity.Notification;
import com.foodrecord.notification.NotificationService;
import com.github.pagehelper.PageInfo;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 通知控制器
 */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    /**
     * 发送通知
     */
    @PostMapping
    public ApiResponse<Boolean> sendNotification(@Validated @RequestBody NotificationRequest request) {
        Notification notification = new Notification();
        notification.setUserId(request.getUserId());
        notification.setType(request.getType());
        notification.setTitle(request.getTitle());
        notification.setContent(request.getContent());
        notification.setLevel(request.getLevel());
        notification.setBusinessId(request.getBusinessId());
        notification.setBusinessType(request.getBusinessType());
        notification.setExtraData(request.getExtraData());
        
        notificationService.sendNotification(notification);
        return ApiResponse.success(true);
    }
    
    /**
     * 获取用户未读通知
     */
    @GetMapping("/unread")
    public ApiResponse<List<NotificationDTO>> getUnreadNotifications(@RequestParam Long userId) {
        List<Notification> notifications = notificationService.getUnreadNotifications(userId);
        List<NotificationDTO> dtos = notifications.stream()
            .map(NotificationDTO::from)
            .collect(Collectors.toList());
        return ApiResponse.success(dtos);
    }
    
    /**
     * 分页查询通知
     */
    @GetMapping
    public ApiResponse<PageInfo<NotificationDTO>> queryNotifications(NotificationQuery query) {
        PageInfo<Notification> pageInfo = notificationService.queryNotifications(query);
        List<NotificationDTO> dtos = pageInfo.getList().stream()
            .map(NotificationDTO::from)
            .collect(Collectors.toList());
        
        PageInfo<NotificationDTO> result = new PageInfo<>();
        result.setList(dtos);
        result.setTotal(pageInfo.getTotal());
        result.setPageNum(pageInfo.getPageNum());
        result.setPageSize(pageInfo.getPageSize());
        
        return ApiResponse.success(result);
    }
    
    /**
     * 标记通知为已读
     */
    @PutMapping("/{id}/read")
    public ApiResponse<Boolean> markAsRead(@PathVariable Long id) {
        notificationService.markAsRead(id);
        return ApiResponse.success(true);
    }
    
    /**
     * 标记所有通知为已读
     */
    @PutMapping("/read/all")
    public ApiResponse<Boolean> markAllAsRead(@RequestParam Long userId) {
        notificationService.markAllAsRead(userId);
        return ApiResponse.success(true);
    }
    
    /**
     * 删除通知
     */
    @DeleteMapping("/{id}")
    public ApiResponse<Boolean> deleteNotification(@PathVariable Long id) {
        notificationService.deleteNotification(id);
        return ApiResponse.success(true);
    }
}