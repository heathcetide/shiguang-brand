package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.model.dto.LoginRequest;
import com.foodrecord.model.dto.RegisterByEmail;
import com.foodrecord.model.dto.RegisterRequest;
import com.foodrecord.model.entity.ThirdPartyAccount;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.model.vo.UserVO;
import com.foodrecord.service.UserService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiImplicitParam;
import io.swagger.annotations.ApiImplicitParams;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import javax.mail.MessagingException;
import javax.validation.Valid;
import javax.validation.constraints.Email;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
@Api(tags = "用户模块")
public class UserController {

    @Resource
    private UserService userService;

    /**
     * 示例 1: Android设备
     * String deviceId = "a6b8f5c3-48d3-4c5e-b124-f7653dcd78f4"; // UUID
     * String deviceType = "Android";
     * String ipAddress = "192.168.0.101";
     * 示例 2: iOS设备
     * String deviceId = "f8e9a4d3-5e2b-45c7-a4f5-cd3d1b2e4f5a"; // UUID
     * String deviceType = "iOS";
     * String ipAddress = "172.16.10.23";
     * 示例 3: Web浏览器
     * String deviceId = "chrome-browser-1234567890";
     * String deviceType = "Web";
     * String ipAddress = "203.0.113.5";
     * 示例 4: Windows PC
     * String deviceId = "win10-pc-abcdef123456";
     * String deviceType = "Windows";
     * String ipAddress = "10.0.0.15";
     * 示例 5: Linux服务器
     * String deviceId = "linux-server-987654321";
     * String deviceType = "Linux";
     * String ipAddress = "8.8.8.8";
     */

    @PostMapping("/login")
    @ApiOperation("用户密码登录功能")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "X-Device-Id", value = "设备ID", required = false, paramType = "header"),
            @ApiImplicitParam(name = "X-Device-Type", value = "设备类型", required = false, paramType = "header"),
            @ApiImplicitParam(name = "X-IP-Address", value = "IP地址", required = false, paramType = "header")
    })
    public ApiResponse<Map<String, String>> login(
            @Valid @RequestBody LoginRequest request,
            @RequestHeader(value = "device-id", required = false) String deviceId,
            @RequestHeader(value = "device-type", required = false) String deviceType,
            @RequestHeader(value = "ip-address", required = false) String ipAddress,
            @RequestHeader(value = "user-agent", required = false) String userAgent) {

        String token = userService.login(request, deviceId, deviceType, ipAddress, userAgent);

        // 返回 token 和 refreshToken
        Map<String, String> response = new HashMap<>();
        response.put("token", token);

        return ApiResponse.success(response);
    }

    /**
     * 用户注册
     * @param request
     * @return
     */
    @PostMapping("/register")
    @ApiOperation("用户注册功能")
    public ApiResponse<User> register(@Valid @RequestBody RegisterRequest request) {
        User user = userService.register(request);
        user.setPassword(null); // 不返回密码
        return ApiResponse.success(user);
    }

    /**
     * 发送邮箱验证码
     * @param email
     * @return
     */
    @PostMapping("/email/code")
    @ApiOperation("邮箱验证码发送")
    public ApiResponse<Boolean> sendEmailCode(@Email @RequestParam String email){
        Boolean isSuccess = userService.sendEmailCode(email);
        if (isSuccess){
            return ApiResponse.success(true);
        }else{
            return ApiResponse.error(300,"发送失败");
        }
    }

    /**
     * 邮箱注册账号
     * @param registerByEmail
     * @return
     */
    @PostMapping("/register/email")
    @ApiOperation("邮箱注册账号")
    public ApiResponse<UserVO> registerEmail(@Valid @RequestBody RegisterByEmail registerByEmail) {
        return userService.registerByEmail(registerByEmail);
    }

    /**
     * 邮箱登录
     * @param registerByEmail
     * @return
     */
    @PostMapping("/login/email")
    @ApiOperation("邮箱登录账号")
    public ApiResponse<String> loginByEmail(
            @Valid @RequestBody RegisterByEmail registerByEmail,
            @RequestHeader(value = "device-id", required = false) String deviceId,
            @RequestHeader(value = "device-type", required = false) String deviceType,
            @RequestHeader(value = "ip-address", required = false) String ipAddress,
            @RequestHeader(value = "user-agent", required = false) String userAgent) {
        return userService.loginByEmail(registerByEmail, deviceId, deviceType, ipAddress,userAgent);
    }

    /**
     * 普通用户查看自己的信息
     * @param username
     * @return
     */
    @GetMapping("/{username}")
    @ApiOperation("用户根据username查看自己的信息")
    @RequireRole({"USER", "ADMIN", "SUPER_ADMIN"})
    public ApiResponse<UserVO> getUserById(@PathVariable String username) {
        User userById = userService.getUserByUsername(username);
        return ApiResponse.success(new UserVO().toUserVO(userById));
    }

    /**
     * 普通用户修改自己的信息
     * @param user
     * @return
     */
    @PutMapping("/update")
    @ApiOperation("普通用户修改自己的信息")
    @RequireRole({"USER", "ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> updateUser(@RequestBody User user) {
        String username = user.getUsername();
        User userById = userService.getUserByUsername(username);
        if (userById != null) {
            user.setId(userById.getId());
            return ApiResponse.success(userService.updateById(user));
        }
        return ApiResponse.success(false);
    }

    /**
     * 用户退出登录
     * @param token
     * @return
     */
    @PostMapping("/logout")
    @ApiOperation("用户退出登录")
    @RequireRole({"USER", "ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Void> logout(@RequestHeader("Authorization") String token) {
        userService.logoutUser(token);
        return ApiResponse.success(null);
    }

    /**
     * 重置密码
     * @param emailOrPhone
     * @param newPassword
     * @return
     */
    @PostMapping("/reset-password")
    @ApiOperation("重置密码-忘记密码的情况下，通过邮箱或手机号验证身份后设置新密码")
    public ApiResponse<Void> resetPassword(@RequestParam String emailOrPhone, @RequestParam String newPassword) {
        userService.resetPassword(emailOrPhone, newPassword);
        return ApiResponse.success(null);
    }

    /**
     * 修改密码
     * @param token
     * @param oldPassword
     * @param newPassword
     * @return
     */
    @PostMapping("/change-password")
    @ApiOperation("修改密码-用户知道当前的密码，并通过身份验证来更改密码")
    public ApiResponse<Void> changePassword(@RequestHeader("Authorization") String token,
                                            @RequestParam String oldPassword,
                                            @RequestParam String newPassword) {
        userService.changePassword(token, oldPassword, newPassword);
        return ApiResponse.success(null);
    }

    /**
     * 上传头像
     * @param file
     * @param token
     * @return
     */
    @PostMapping("/upload-avatar")
    @ApiOperation("上传头像")
    public ApiResponse<String> uploadAvatar(@RequestParam("file") MultipartFile file, @RequestHeader("Authorization") String token) {
        String avatarUrl = userService.uploadAvatar(file, token);
        return ApiResponse.success(avatarUrl);
    }

    /**
     * 注销用户
     * @param token
     * @return
     */
    @PostMapping("/delete-account")
    @ApiOperation("注销用户")
    public ApiResponse<Void> deleteAccount(@RequestHeader("Authorization") String token) {
        userService.requestAccountDeletion(token);
        return ApiResponse.success(null);
    }

    /**
     * 开启二级验证码
     * @param emailOrPhone
     * @return
     * @throws MessagingException
     */
    @PostMapping("/send-verification-code")
    @ApiOperation("开启二级验证码")
    public ApiResponse<Void> sendVerificationCode(@RequestParam String emailOrPhone) throws MessagingException {
        userService.sendVerificationCode(emailOrPhone);
        return ApiResponse.success(null);
    }

    /**
     * 开启验证
     * @param emailOrPhone
     * @param code
     * @return
     */
    @PostMapping("/verify")
    @ApiOperation("开启验证")
    public ApiResponse<Void> verifyCode(@RequestParam String emailOrPhone, @RequestParam String code) {
        userService.verifyCode(emailOrPhone, code);
        return ApiResponse.success(null);
    }

    /**
     * 搜索公开用户
     * @param keyword
     * @return
     */
    @GetMapping("/search")
    @ApiOperation("搜索公开用户")
    public ApiResponse<List<User>> searchUsers(@RequestParam String keyword,
                                               @RequestParam int page,
                                               @RequestParam int size) {
        return ApiResponse.success(userService.searchPublicUsers(keyword, page, size));
    }

    /**
     * 绑定第三方账号（未实现）
     * @param token
     * @param account
     * @return
     */
    @PostMapping("/bind-account")
    @ApiOperation("绑定第三方账号（未实现）")
    public ApiResponse<Void> bindAccount(@RequestHeader("Authorization") String token, @RequestBody ThirdPartyAccount account) {
        userService.bindThirdPartyAccount(token, account);
        return ApiResponse.success(null);
    }

    /**
     * 解绑第三方账号（未实现）
     * @param token
     * @param platform
     * @return
     */
    @PostMapping("/unbind-account")
    @ApiOperation("解绑第三方账号（未实现）")
    public ApiResponse<Void> unbindAccount(@RequestHeader("Authorization") String token, @RequestParam String platform) {
        userService.unbindThirdPartyAccount(token, platform);
        return ApiResponse.success(null);
    }

    /**
     * 开启2fa验证（未实现）
     * @param token
     * @param secretKey
     * @return
     */
    @PostMapping("/enable-2fa")
    @ApiOperation("开启2fa验证（未实现）")
    public ApiResponse<Void> enableTwoFactorAuth(@RequestHeader("Authorization") String token, @RequestBody String secretKey) {
        userService.enableTwoFactorAuth(token, secretKey);
        return ApiResponse.success(null);
    }

    /**
     * 2fa验证码（未实现）
     * @param token
     * @param verificationCode
     * @return
     */
    @PostMapping("/verify-2fa")
    @ApiOperation("2fa验证码（未实现）")
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