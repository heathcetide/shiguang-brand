package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.exception.CustomException;
import com.foodrecord.common.utils.CaptchaUtils;
import com.foodrecord.common.utils.JwtUtils;
import com.foodrecord.model.dto.LoginRequest;
import com.foodrecord.model.dto.RegisterByEmail;
import com.foodrecord.model.dto.RegisterRequest;
import com.foodrecord.model.entity.Levels;
import com.foodrecord.model.entity.ThirdPartyAccount;
import com.foodrecord.model.entity.UserLevels;
import com.foodrecord.model.entity.User;
import com.foodrecord.model.vo.UserInfoLevelVO;
import com.foodrecord.model.vo.UserVO;
import com.foodrecord.service.LevelsService;
import com.foodrecord.service.UserLevelsService;
import com.foodrecord.service.UserService;
import io.swagger.annotations.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import javax.imageio.ImageIO;
import javax.mail.MessagingException;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import javax.validation.Valid;
import javax.validation.constraints.Email;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
@Api(tags = "用户模块")
public class UserController {

    @Autowired
    @Qualifier("foodUserService")
    private UserService userService;

    @Resource
    private UserLevelsService userLevelsService;

    @Resource
    private LevelsService levelsService;

    @Resource
    private JwtUtils jwtUtils;
    // 静态日志实例
    private static final Logger logger = LoggerFactory.getLogger(UserController.class);

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
     *
     * @param request 用户注册请求
     * @return 用户信息
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
     *
     * @param email 邮箱
     * @return 发送状态
     */
    @PostMapping("/email/code")
    @ApiOperation("邮箱验证码发送")
    public ApiResponse<Boolean> sendEmailCode(@Email @RequestParam String email) {
        Boolean isSuccess = userService.sendEmailCode(email);
        if (isSuccess) {
            return ApiResponse.success(true);
        } else {
            return ApiResponse.error(300, "发送失败");
        }
    }

    @GetMapping("/info")
    @ApiOperation("根据token获取角色信息")
    public ApiResponse<UserVO> getUserInfoByToken(@RequestHeader("Authorization") String token) {
        try {
            if (token == null || token.isEmpty()){
                return ApiResponse.error(300, "未登录或token已过期");
            }
            if (token.startsWith("Bearer ")) {
                token = token.substring(7);
            }
            String usernameFromToken = jwtUtils.getUsernameFromToken(token);
            User currentUser = userService.getUserByUsername(usernameFromToken);
            currentUser.setPassword(null);
            return ApiResponse.success(new UserVO().toUserVO(currentUser));
        }catch (Exception e){
            System.out.println("获取用户信息失败"+ e.getMessage());
            e.printStackTrace();
            return ApiResponse.error(300, "操作失败");
        }
    }

    @GetMapping("/info/level")
    @ApiOperation("根据token获取角色信息")
    public ApiResponse<UserInfoLevelVO> getUserLevelByToken(@RequestHeader("Authorization") String token) {
        try {
            if (token == null || token.isEmpty()){
                return ApiResponse.error(300, "未登录或token已过期");
            }
            if (token.startsWith("Bearer ")) {
                token = token.substring(7);
            }
            String usernameFromToken = jwtUtils.getUsernameFromToken(token);
            User currentUser = userService.getUserByUsername(usernameFromToken);
            currentUser.setPassword(null);
            UserInfoLevelVO userInfoLevelVO = new UserInfoLevelVO().toUserInfoLevelVO(currentUser);
            UserLevels userLevelsByUserId = userLevelsService.getUserLevelsByUserId(currentUser.getId());
            Levels levelById = levelsService.getLevelById(userLevelsByUserId.getLevelId());
            userInfoLevelVO.setLevelName(levelById.getLevelName());
            userInfoLevelVO.setMinPoints(levelById.getMinPoints());
            userInfoLevelVO.setMaxPoints(levelById.getMaxPoints());
            userInfoLevelVO.setLevelPoints(userLevelsByUserId.getLevelPoints());
            return ApiResponse.success(userInfoLevelVO);
        }catch (Exception e){
            System.out.println("获取用户信息失败"+ e.getMessage());
            e.printStackTrace();
            return ApiResponse.error(300, "操作失败");
        }
    }

    /**
     * 邮箱注册账号
     *
     * @param registerByEmail 注册信息
     * @return 返回用户信息
     */
    @PostMapping("/register/email")
    @ApiOperation("邮箱注册账号")
    public ApiResponse<UserVO> registerEmail(@Valid @RequestBody RegisterByEmail registerByEmail) {
        return userService.registerByEmail(registerByEmail);
    }

    /**
     * 邮箱登录
     *
     * @param registerByEmail 注册信息
     * @return 返回用户信息
     */
    @PostMapping("/login/email")
    @ApiOperation("邮箱登录账号")
    public ApiResponse<String> loginByEmail(
            @Valid @RequestBody RegisterByEmail registerByEmail,
            @RequestHeader(value = "device-id", required = false) String deviceId,
            @RequestHeader(value = "device-type", required = false) String deviceType,
            @RequestHeader(value = "ip-address", required = false) String ipAddress,
            @RequestHeader(value = "user-agent", required = false) String userAgent) {
        return userService.loginByEmail(registerByEmail, deviceId, deviceType, ipAddress, userAgent);
    }

    /**
     * 普通用户查看自己的信息
     *
     * @param username 用户名
     * @return 用户信息
     */
    @GetMapping("/{username}")
    @ApiOperation("用户根据username查看自己的信息")
    @RequireRole({"USER", "ADMIN", "SUPER_ADMIN"})
    public ApiResponse<UserVO> getUserById(@PathVariable String username) {
        try {
            // 日志记录
            logger.info("Fetching user information for username: {}", username);

            // 调用服务获取用户信息
            User user = userService.getUserByUsername(username);

            // 返回成功响应
            return ApiResponse.success(new UserVO().toUserVO(user));
        } catch (CustomException e) {
            // 捕获自定义异常，返回友好提示
            logger.warn("Failed to fetch user information: {}", e.getMessage());
            return ApiResponse.error(404, e.getMessage());
        } catch (Exception e) {
            // 捕获未预期异常，记录日志并返回通用错误提示
            logger.error("Unexpected error occurred while fetching user information", e);
            return ApiResponse.error(500, "服务器内部错误");
        }
    }

    /**
     * 普通用户修改自己的信息
     *
     * @param user 修改后的用户信息
     * @return 用户信息
     */
    @PutMapping("/update")
    @ApiOperation("普通用户修改自己的信息")
    public ApiResponse<User> updateUser(@RequestBody User user, @RequestHeader("Authorization") String token) {
        logger.info("Request received in updateUser: user={}, token={}", user, token); // 添加日志
        try {
            User updatedUser = userService.updateUserInfo(user, token);
            return ApiResponse.success(updatedUser);
        } catch (IllegalArgumentException e) {
            return ApiResponse.error(300, e.getMessage());
        } catch (Exception e) {
            logger.error("Unexpected error occurred while updating user info", e);
            return ApiResponse.error(500, "服务器内部错误");
        }
    }

    /**
     * 用户退出登录
     *
     * @param token jwt信息
     * @return 退出登录状态
     */
    @PostMapping("/logout")
    @ApiOperation("用户退出登录")
    @RequireRole({"USER", "ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Void> logout(@RequestHeader("Authorization") String token) {
        userService.logoutUser(token);
        return ApiResponse.success(null);
    }

    /**
     * 生成校验二维码
     * @param session session
     * @param response response
     * @throws IOException 异常
     */
    @GetMapping("/captcha")
    @ApiOperation("生成校验二维码")
    public void getCaptcha(
            @ApiParam(value = "当前会话的 HttpSession", required = true) HttpSession session,
            @ApiParam(value = "HTTP 响应对象，用于输出验证码图片", required = true) HttpServletResponse response) throws IOException {
        String sessionId = session.getId();
        System.out.println("Session ID (getCaptcha): " + sessionId);
        String captchaText = CaptchaUtils.generateCaptchaText(6);
        System.out.println("Generated Captcha Text: " + captchaText);
        session.setAttribute("captcha", captchaText);

        // 生成验证码图片
        BufferedImage image = CaptchaUtils.generateCaptchaImage(captchaText);
        response.setContentType("image/png");
        response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); // 禁用缓存
        response.setHeader("Pragma", "no-cache");
        response.setDateHeader("Expires", 0);
        // 将图片写入响应流
        ImageIO.write(image, "png", response.getOutputStream());
    }

    /**
     * 验证校验二维码
     * @param request request
     * @param session session
     * @return 验证结果
     */
    @PostMapping("/verify-captcha")
    @ApiOperation("验证校验二维码")
    public ApiResponse<Boolean> verifyCaptcha(
            @ApiParam(value = "包含用户输入验证码的请求数据", required = true) @RequestBody Map<String, String> request,
            @ApiParam(value = "当前会话的 HttpSession", required = true) HttpSession session) {
        String sessionId = session.getId();
        System.out.println("Session ID (verifyCaptcha): " + sessionId);
        String userCaptcha = request.get("captcha");
        String sessionCaptcha = (String) session.getAttribute("captcha");
        System.out.println("User Captcha: " + userCaptcha + " Session Captcha: " + sessionCaptcha);
        boolean success = userCaptcha != null && userCaptcha.equalsIgnoreCase(sessionCaptcha);
        System.out.println("Verification Result: " + success);
        return ApiResponse.success(success);
    }

    /**
     * 重置密码
     *
     * @param emailOrPhone 重置密码
     * @param newPassword 新密码
     * @return 重置密码
     */
    @PostMapping("/reset-password")
    @ApiOperation("重置密码-忘记密码的情况下，通过邮箱或手机号验证身份后设置新密码")
    public ApiResponse<Void> resetPassword(
            @ApiParam(value = "邮箱或手机", required = true) @RequestParam String emailOrPhone,
            @ApiParam(value = "新密码", required = true) @RequestParam String newPassword) {
        userService.resetPassword(emailOrPhone, newPassword);
        return ApiResponse.success(null);
    }

    /**
     * 修改密码
     *
     * @param token jwt
     * @param oldPassword 旧密码
     * @param newPassword 新密码
     * @return 修改密码
     */
    @PostMapping("/change-password")
    @ApiOperation("修改密码-用户知道当前的密码，并通过身份验证来更改密码")
    public ApiResponse<Void> changePassword(@RequestHeader("Authorization") String token,
                      @ApiParam(value = "旧密码", required = true) @RequestParam String oldPassword,
                      @ApiParam(value = "新密码", required = true) @RequestParam String newPassword) {
        userService.changePassword(token, oldPassword, newPassword);
        return ApiResponse.success(null);
    }

    /**
     * 上传头像
     *
     * @param file 文件
     * @param token jwt
     * @return 上传头像
     */
    @PostMapping("/upload-avatar")
    @ApiOperation("上传头像")
    public ApiResponse<String> uploadAvatar(
            @ApiParam(value = "上传文件") @RequestParam("file") MultipartFile file,
            @RequestHeader("Authorization") String token) {
        String avatarUrl = userService.uploadAvatar(file, token);
        return ApiResponse.success(avatarUrl);
    }

    /**
     * 注销用户
     *
     * @param token jwt
     * @return 注销用户
     */
    @PostMapping("/delete-account")
    @ApiOperation("注销用户")
    public ApiResponse<Void> deleteAccount(@RequestHeader("Authorization") String token) {
        userService.requestAccountDeletion(token);
        return ApiResponse.success(null);
    }

    /**
     * 开启二级验证码
     *
     * @param emailOrPhone 开启二级验证
     * @return 开启二级验证
     * @throws MessagingException 异常
     */
    @PostMapping("/send-verification-code")
    @ApiOperation("开启二级验证码")
    public ApiResponse<Void> sendVerificationCode(@RequestParam String emailOrPhone) throws MessagingException {
        userService.sendVerificationCode(emailOrPhone);
        return ApiResponse.success(null);
    }

    /**
     * 开启验证
     *
     * @param emailOrPhone 开启二级验证
     * @param code 验证码
     * @return 返回
     */
    @PostMapping("/verify")
    @ApiOperation("开启验证")
    public ApiResponse<Void> verifyCode(@RequestParam String emailOrPhone, @RequestParam String code) {
        userService.verifyCode(emailOrPhone, code);
        return ApiResponse.success(null);
    }

    /**
     * 搜索公开用户
     *
     * @param keyword 搜索用户
     * @return 返回用户列表
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
     *
     * @param token jwt
     * @param account 帐号啊
     * @return 绑定第三方账号
     */
    @PostMapping("/bind-account")
    @ApiOperation("绑定第三方账号（未实现）")
    public ApiResponse<Void> bindAccount(@RequestHeader("Authorization") String token, @RequestBody ThirdPartyAccount account) {
        userService.bindThirdPartyAccount(token, account);
        return ApiResponse.success(null);
    }

    /**
     * 解绑第三方账号（未实现）
     *
     * @param token jwt
     * @param platform 平台
     * @return 解绑第三方账号
     */
    @PostMapping("/unbind-account")
    @ApiOperation("解绑第三方账号（未实现）")
    public ApiResponse<Void> unbindAccount(@RequestHeader("Authorization") String token, @RequestParam String platform) {
        userService.unbindThirdPartyAccount(token, platform);
        return ApiResponse.success(null);
    }
} 