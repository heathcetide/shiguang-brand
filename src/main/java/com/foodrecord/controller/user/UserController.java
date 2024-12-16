package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.LoginRequest;
import com.foodrecord.model.dto.RegisterRequest;
import com.foodrecord.model.entity.ThirdPartyAccount;
import com.foodrecord.model.entity.User;
import com.foodrecord.service.UserService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @Resource
    private UserService userService;


    @PostMapping("/login")
    public ApiResponse<Map<String, String>> login(@Valid @RequestBody LoginRequest request) {
        String token = userService.login(request);
        Map<String, String> response = new HashMap<>();
        response.put("token", token);
        return ApiResponse.success(response);
    }

    @PostMapping("/register")
    public ApiResponse<User> register(@Valid @RequestBody RegisterRequest request) {
        User user = userService.register(request);
        user.setPassword(null); // 不返回密码
        return ApiResponse.success(user);
    }

    // 普通用户查看自己的信息
    @GetMapping("/{id}")
    public User getUserById(@PathVariable Long id) {
        return userService.getUserById(id);
    }

    // 普通用户修改自己的信息
    @PutMapping("/{id}")
    public boolean updateUser(@PathVariable Long id, @RequestBody User user) {
        user.setId(id);
        return userService.updateById(user);
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(@RequestHeader("Authorization") String token) {
        userService.logoutUser(token); // 在服务中清理 Token
        return ApiResponse.success(null);
    }

    @PostMapping("/reset-password")
    public ApiResponse<Void> resetPassword(@RequestParam String emailOrPhone, @RequestParam String newPassword) {
        userService.resetPassword(emailOrPhone, newPassword);
        return ApiResponse.success(null);
    }

    @PostMapping("/change-password")
    public ApiResponse<Void> changePassword(@RequestHeader("Authorization") String token,
                                            @RequestParam String oldPassword,
                                            @RequestParam String newPassword) {
        userService.changePassword(token, oldPassword, newPassword);
        return ApiResponse.success(null);
    }

    @PostMapping("/upload-avatar")
    public ApiResponse<String> uploadAvatar(@RequestParam("file") MultipartFile file, @RequestHeader("Authorization") String token) {
        String avatarUrl = userService.uploadAvatar(file, token);
        return ApiResponse.success(avatarUrl);
    }

    @PostMapping("/delete-account")
    public ApiResponse<Void> deleteAccount(@RequestHeader("Authorization") String token) {
        userService.requestAccountDeletion(token);
        return ApiResponse.success(null);
    }


    @PostMapping("/send-verification-code")
    public ApiResponse<Void> sendVerificationCode(@RequestParam String emailOrPhone) {
        userService.sendVerificationCode(emailOrPhone);
        return ApiResponse.success(null);
    }

    @PostMapping("/verify")
    public ApiResponse<Void> verifyCode(@RequestParam String emailOrPhone, @RequestParam String code) {
        userService.verifyCode(emailOrPhone, code);
        return ApiResponse.success(null);
    }

    @GetMapping("/search")
    public ApiResponse<List<User>> searchUsers(@RequestParam String keyword) {
        return ApiResponse.success(userService.searchPublicUsers(keyword));
    }

    @GetMapping("/statistics")
    public ApiResponse<Map<String, Object>> getUserStatistics(@RequestHeader("Authorization") String token) {
        return ApiResponse.success(userService.getUserStatistics(token));
    }

    @PostMapping("/bind-account")
    public ApiResponse<Void> bindAccount(@RequestHeader("Authorization") String token, @RequestBody ThirdPartyAccount account) {
        userService.bindThirdPartyAccount(token, account);
        return ApiResponse.success(null);
    }

    @PostMapping("/unbind-account")
    public ApiResponse<Void> unbindAccount(@RequestHeader("Authorization") String token, @RequestParam String platform) {
        userService.unbindThirdPartyAccount(token, platform);
        return ApiResponse.success(null);
    }

    @PostMapping("/enable-2fa")
    public ApiResponse<Void> enableTwoFactorAuth(@RequestHeader("Authorization") String token, @RequestBody String secretKey) {
        userService.enableTwoFactorAuth(token, secretKey);
        return ApiResponse.success(null);
    }

    @PostMapping("/verify-2fa")
    public ApiResponse<Void> verifyTwoFactorAuth(@RequestHeader("Authorization") String token, @RequestBody String verificationCode) {
        userService.verifyTwoFactorAuth(token, verificationCode);
        return ApiResponse.success(null);
    }


//    /**
//     * 查看行为
//     */
//    @GetMapping("/logs")
//    public ApiResponse<List<OperationLog>> getOperationLogs(@RequestHeader("Authorization") String token) {
//        return ApiResponse.success(operationLogService.getLogsByUserId(userService.getUserIdFromToken(token)));
//    }
//    /**
//     * 查看通知
//     */
//    @GetMapping("/notifications")
//    public ApiResponse<List<Notification>> getNotifications(@RequestHeader("Authorization") String token) {
//        return ApiResponse.success(notificationService.getNotificationsByUserId(userService.getUserIdFromToken(token)));
//    }
//    /**
//     * 用户偏好设置
//     */
//    @PutMapping("/preferences")
//    public ApiResponse<Void> updatePreferences(@RequestHeader("Authorization") String token,
//                                               @RequestBody UserPreferences preferences) {
//        userService.updatePreferences(token, preferences);
//        return ApiResponse.success(null);
//    }


} 