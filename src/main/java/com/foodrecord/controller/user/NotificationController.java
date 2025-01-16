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
import io.swagger.annotations.ApiImplicitParam;
import io.swagger.annotations.ApiImplicitParams;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
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

    @Resource
    private NotificationService notificationService;

    @Resource
    private UserReminderService reminderService;

    @Resource
    private UserReminderTask reminderTask;

    /**
     * 更新提醒时间
     *
     * @param token 授权令牌
     * @param mealType 餐点类型（breakfast, lunch, dinner）
     * @param time 提醒时间
     * @return 更新结果信息
     */
    @PostMapping("/update")
    @ApiOperation("更新提醒时间")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "token", value = "授权令牌", required = true, dataType = "String", paramType = "header"),
            @ApiImplicitParam(name = "mealType", value = "餐点类型（breakfast, lunch, dinner）", required = true, dataType = "String", paramType = "query"),
            @ApiImplicitParam(name = "time", value = "提醒时间", required = true, dataType = "String", paramType = "query")
    })
    public String updateReminder(@RequestHeader("Authorization") String token,
                                 @RequestParam String mealType,
                                 @RequestParam String time) {
        Long userId = getUserIdFromToken(token);
        LocalTime reminderTime = LocalTime.parse(time);
        reminderService.setReminderTime(userId, mealType, reminderTime);
        reminderTask.loadUserTasks(userId);
        return "提醒时间已更新";
    }

    /**
     * 获取提醒列表
     *
     * @param token 授权令牌
     * @return 包含提醒时间的Map对象
     */
    @GetMapping("/list")
    @ApiOperation("获取提醒列表")
    @ApiImplicitParam(name = "token", value = "授权令牌", required = true, dataType = "String", paramType = "header")
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
     *
     * @param request 通知请求对象
     * @return 发送结果
     */
    @PostMapping
    @ApiOperation("发送通知")
    @ApiImplicitParam(name = "request", value = "通知请求对象", required = true, dataType = "NotificationRequest", paramType = "body")
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
     *
     * @param userId 用户ID
     * @return 包含未读通知列表的ApiResponse对象
     */
    @GetMapping("/unread")
    @ApiOperation("获取用户未读通知")
    @ApiImplicitParam(name = "userId", value = "用户ID", required = true, dataType = "Long", paramType = "query")
    public ApiResponse<List<NotificationDTO>> getUnreadNotifications(@RequestParam Long userId) {
        List<Notification> notifications = notificationService.getUnreadNotifications(userId);
        List<NotificationDTO> dtos = notifications.stream()
                .map(NotificationDTO::from)
                .collect(Collectors.toList());
        return ApiResponse.success(dtos);
    }

    /**
     * 分页查询通知
     *
     * @param query 通知查询对象
     * @return 包含分页通知列表的ApiResponse对象
     */
    @GetMapping
    @ApiOperation("分页查询通知")
    @ApiImplicitParam(name = "query", value = "通知查询对象", required = true, dataType = "NotificationQuery", paramType = "query")
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
     *
     * @param id 通知ID
     * @return 标记结果
     */
    @PutMapping("/{id}/read")
    @ApiOperation("标记通知为已读")
    @ApiImplicitParam(name = "id", value = "通知ID", required = true, dataType = "Long", paramType = "path")
    public ApiResponse<Boolean> markAsRead(@PathVariable Long id) {
        notificationService.markAsRead(id);
        return ApiResponse.success(true);
    }

    /**
     * 标记所有通知为已读
     *
     * @param userId 用户ID
     * @return 标记结果
     */
    @PutMapping("/read/all")
    @ApiOperation("标记所有通知为已读")
    @ApiImplicitParam(name = "userId", value = "用户ID", required = true, dataType = "Long", paramType = "query")
    public ApiResponse<Boolean> markAllAsRead(@RequestParam Long userId) {
        notificationService.markAllAsRead(userId);
        return ApiResponse.success(true);
    }

    /**
     * 删除通知
     *
     * @param id 通知ID
     * @return 删除结果
     */
    @DeleteMapping("/{id}")
    @ApiOperation("删除通知")
    @ApiImplicitParam(name = "id", value = "通知ID", required = true, dataType = "Long", paramType = "path")
    public ApiResponse<Boolean> deleteNotification(@PathVariable Long id) {
        notificationService.deleteNotification(id);
        return ApiResponse.success(true);
    }
}