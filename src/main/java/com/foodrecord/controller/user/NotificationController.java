package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.TokenService;
import com.foodrecord.model.dto.NotificationDTO;
import com.foodrecord.model.dto.NotificationQuery;
import com.foodrecord.model.dto.NotificationRequest;
import com.foodrecord.model.entity.Notification;
import com.foodrecord.notification.NotificationService;
import com.foodrecord.task.UserReminderService;
import com.foodrecord.task.UserReminderTask;
import com.github.pagehelper.PageInfo;
import io.swagger.annotations.Api;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 通知控制器
 */
@RestController
@RequestMapping("/api/notifications")
@Api(tags = "消息通知模块")
public class NotificationController {

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private UserReminderService reminderService;

    @Autowired
    private UserReminderTask reminderTask;

    @PostMapping("/update")
    public String updateReminder(@RequestHeader("Authorization") String token,
                                 @RequestParam String mealType,
                                 @RequestParam String time) {
        Long userId = getUserIdFromToken(token);
        LocalTime reminderTime = LocalTime.parse(time);
        reminderService.setReminderTime(userId, mealType, reminderTime);
        reminderTask.loadUserTasks(userId);
        return "提醒时间已更新";
    }

    @GetMapping("/list")
    public Map<String, String> getReminders(@RequestHeader("Authorization") String token) {
        Long userId = getUserIdFromToken(token);
        Map<String, String> reminders = new HashMap<>();
        for (String mealType : new String[]{"breakfast", "lunch", "dinner"}) {
            LocalTime time = reminderService.getReminderTime(userId, mealType);
            reminders.put(mealType, time.toString());
        }
        return reminders;
    }

    private Long getUserIdFromToken(String token) {
        // 假设 TokenService 提供解码用户ID的方法
        return new TokenService().getUserIdFromToken(token);
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