package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.TokenService;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.common.utils.JwtUtils;
import com.foodrecord.common.utils.PasswordEncoder;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.UserMapper;
import com.foodrecord.model.dto.LoginRequest;
import com.foodrecord.model.dto.RegisterByEmail;
import com.foodrecord.model.dto.RegisterRequest;
import com.foodrecord.model.entity.ThirdPartyAccount;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.model.vo.UserVO;
import com.foodrecord.notification.FileStorageService;
import com.foodrecord.notification.SmsService;
import com.foodrecord.notification.impl.EmailNotificationSender;
import com.foodrecord.service.ThirdPartyAccountService;
import com.foodrecord.service.UserService;

import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.DigestUtils;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import javax.mail.MessagingException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.TimeUnit;

import static com.foodrecord.common.auth.Roles.USER;


@Service
public class UserServiceImpl extends ServiceImpl<UserMapper, User> implements UserService {
    @Resource
    private UserMapper userMapper;

    @Resource
    private ThirdPartyAccountService thirdPartyAccountService;

    @Resource
    private EmailNotificationSender emailNotificationSender;

    @Resource
    private FileStorageService fileStorageService;

    @Resource
    private SmsService smsService;

    @Resource
    private JwtUtils jwtUtils;

    @Resource
    private RedisUtils redisUtils;

    @Resource
    private TokenService tokenService;

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    // 过期时间
    private static final long USER_CACHE_TIME = 3600; // 1小时
    private static final long TOKEN_CACHE_TIME = 86400; // 24小时
    // 验证码 Redis Key 前缀
    private static final String SEND_EMAIL_CODE = "email_code:";
    private static final String SEND_EMAIL_CODE_SEND_TIME = "email_code_send_time:";
    private static final String NEW_USER_NICKNAME = generateRandomNickname();
    private static final String USER_CACHE_KEY = "user:";
    private static final String TOKEN_CACHE_KEY = "token:";
    // 验证码有效期（10 分钟）
    private static final long SEND_EMAIL_CODE_TIME = 10;
    // 发送间隔时间（1 分钟）
    private static final long SEND_EMAIL_SEND_INTERVAL = 1;

    /**
     * 用户密码登录
     *
     * @param request    用户登录请求，包含用户名和密码
     * @param deviceId   登录设备ID
     * @param deviceType 登录设备类型
     * @param ipAddress  登录设备的IP地址
     * @param userAgent  登录设备的用户代理信息
     * @return 登录成功返回Token，失败抛出异常
     */
    @Override
    @Transactional
    public String login(LoginRequest request, String deviceId, String deviceType, String ipAddress, String userAgent) {
        try {
            User user = userMapper.selectByUsername(request.getUsername());
            if (user == null || !PasswordEncoder.matches(request.getPassword(), user.getPassword())) {
                throw new CustomException("用户名或密码错误");
            }
            boolean isSuccess = userMapper.setLastLoginTime(user.getId());
            if (!isSuccess) {
                throw new CustomException("更新登录时间错误");
            }
            String token = jwtUtils.generateToken(String.valueOf(user.getId()));
            // 缓存token和用户信息
            redisUtils.set(TOKEN_CACHE_KEY + user.getId(), token, TOKEN_CACHE_TIME);
            redisUtils.set(USER_CACHE_KEY + user.getUsername(), user, USER_CACHE_TIME);
            redisUtils.set(USER_CACHE_KEY + user.getId(), user, USER_CACHE_TIME);
            tokenService.generateToken(user, deviceId, deviceType, ipAddress, userAgent);
            return token;
        }catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }

    /**
     * 分页获取用户列表
     *
     * @param userPage 分页对象
     * @param keyword  搜索关键字
     * @return 分页的用户列表
     */
    @Override
    public Page<User> getUsers(Page<User> userPage, String keyword) {
        return userMapper.selectUsers(userPage, keyword);
    }

    /**
     * 用户简单注册
     *
     * @param request 用户注册请求，包含用户名、密码、邮箱、手机号等
     * @return 注册成功的用户对象
     */
    @Transactional
    @Override
    public User register(RegisterRequest request) {
        try {

            // 检查用户名是否存在
            if (userMapper.existsByUsername(request.getUsername())) {
                throw new CustomException("用户名已存在");
            }
            // 检查邮箱是否存在
            if (userMapper.existsByEmail(request.getEmail())) {
                throw new CustomException("邮箱已被注册");
            }
            // 检查手机号是否存在
            if (userMapper.existsByPhone(request.getPhone())) {
                throw new CustomException("手机号已被注册");
            }

            User user = new User();
            user.setUsername(request.getUsername());
            user.setPassword(PasswordEncoder.encode(request.getPassword()));
            user.setEmail(request.getEmail());
            user.setPhone(request.getPhone());
            user.setNickname(request.getNickname());
            user.setRole(USER);
            user.setStatus(2);

            int insert = userMapper.insert(user);
            if (insert != 1) {
                throw new CustomException("注册用户失败");
            }
            emailNotificationSender.sendWelcomeEmail(user.getEmail(), user.getUsername());
            // 缓存用户信息
            redisUtils.set(USER_CACHE_KEY + user.getId(), user, USER_CACHE_TIME);
            redisUtils.set(USER_CACHE_KEY + user.getUsername(), user, USER_CACHE_TIME);
            return user;
        }catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }


    /**
     * 用户邮箱注册
     *
     * @param registerByEmail 用户通过邮箱注册请求对象，包含邮箱和验证码
     * @return 注册成功的用户视图对象
     */
    @Override
    @Transactional
    public ApiResponse<UserVO> registerByEmail(RegisterByEmail registerByEmail) {
        String email = registerByEmail.getEmail();
        if (userMapper.existsByEmail(email)) {
            return ApiResponse.error(300,"邮箱已被注册");
        }
        String redisKeyCode = generateRedisKey(email, SEND_EMAIL_CODE);
        if (Boolean.FALSE.equals(redisTemplate.hasKey(redisKeyCode))) {
            return ApiResponse.error(300,"操作失败，请重新发送验证码");
        }
        if (!registerByEmail.getCode().equals(redisTemplate.opsForValue().get(redisKeyCode))) {
            return ApiResponse.error(300,"验证码错误");
        }
        String username = email.split("@")[0] +email.split("@")[1]; // 获取邮箱的前缀部分
        if (userMapper.existsByUsername(username)) {
            // 如果邮箱前缀已被占用，加随机数或后缀
            username += "_" + new Random().nextInt(9000) + 1000;
        }
        try {
            User user = new User();
            user.setUsername(username);
            user.setEmail(registerByEmail.getEmail());
            user.setNickname(NEW_USER_NICKNAME);
            user.setStatus(2);
            user.setRole(USER);
            int insert = userMapper.insert(user);
            if (insert != 1) {
                return ApiResponse.error(300, "注册失败");
            }
            emailNotificationSender.sendWelcomeEmail(user.getEmail(), user.getUsername());
            // 缓存用户信息
            redisUtils.set(USER_CACHE_KEY + user.getId(), user, USER_CACHE_TIME);
            redisUtils.set(USER_CACHE_KEY + user.getUsername(), user, USER_CACHE_TIME);
            return ApiResponse.success(new UserVO().toUserVO(user));
        }catch (Exception e) {
            e.printStackTrace();
        }
        return ApiResponse.error(300,"操作失败");
    }

    /**
     * 用户邮箱登录
     *
     * @param registerByEmail 用户通过邮箱登录请求对象，包含邮箱和验证码
     * @param deviceId        登录设备ID
     * @param deviceType      登录设备类型
     * @param ipAddress       登录设备的IP地址
     * @param userAgent       登录设备的用户代理信息
     * @return 登录成功返回Token，否则返回错误信息
     */
    @Override
    public ApiResponse<String> loginByEmail(RegisterByEmail registerByEmail, String deviceId, String deviceType, String ipAddress, String userAgent) {
        String email = registerByEmail.getEmail();
        // 添加邮箱格式校验
        if (!isValidEmail(email)) {
            return ApiResponse.error(300, "邮箱格式不正确");
        }

        if (!userMapper.existsByEmail(email)) {
            return ApiResponse.error(300,"邮箱未注册");
        }
        String redisKeyCode = generateRedisKey(email, SEND_EMAIL_CODE);
        if (Boolean.FALSE.equals(redisTemplate.hasKey(redisKeyCode))) {
            return ApiResponse.error(300,"操作失败，请重新发送验证码");
        }
        if (!registerByEmail.getCode().equals(redisTemplate.opsForValue().get(redisKeyCode))) {
            return ApiResponse.error(300,"验证码错误");
        }
        User user = userMapper.selectByEmail(registerByEmail.getEmail());
        String token = jwtUtils.generateToken(String.valueOf(user.getId()));
        // 缓存token和用户信息
        redisUtils.set(TOKEN_CACHE_KEY + user.getId(), token, TOKEN_CACHE_TIME);
        redisUtils.set(USER_CACHE_KEY + user.getUsername(), user, USER_CACHE_TIME);
        redisUtils.set(USER_CACHE_KEY + user.getId(), user, USER_CACHE_TIME);
        tokenService.generateToken(user, deviceId, deviceType, ipAddress, userAgent);
        return ApiResponse.success(token);
    }

    /**
     * 发送邮箱验证码
     *
     * @param email 用户邮箱
     * @return 是否发送成功
     */
    @Override
    public Boolean sendEmailCode(String email) {
        String redisKeyCode = generateRedisKey(email, SEND_EMAIL_CODE);
        String redisKeySendTime = generateRedisKey(email, SEND_EMAIL_CODE_SEND_TIME);
        // 检查是否在发送间隔内（例如 1 分钟）
        if (Boolean.TRUE.equals(redisTemplate.hasKey(redisKeySendTime))) {
            log.warn("短时间内重复发送验证码，请稍后重试！");
            return false; // 或者抛出业务异常
        }
        String code = generateRandomCode();
        try {
            // 存储验证码（10 分钟有效期）
            redisTemplate.opsForValue().set(redisKeyCode, code, SEND_EMAIL_CODE_TIME, TimeUnit.MINUTES);
            // 设置发送时间间隔（1 分钟有效期）
            redisTemplate.opsForValue().set(redisKeySendTime, "1", 1, TimeUnit.MINUTES);
            // 发送邮件（带重试机制）
            sendEmailWithRetry(email, code, 3, 1000);
            System.out.println("验证码发送成功，邮件：" + email + "，验证码：" + code);
            return true;
        } catch (RedisConnectionFailureException redisEx) {
            System.out.println("Redis 操作失败：" + redisEx.getMessage() + redisEx);
            throw new RuntimeException("系统错误，请稍后重试");
        } catch (Exception e) {
            // 删除 Redis 中的数据，防止冗余
            redisTemplate.delete(redisKeyCode);
            redisTemplate.delete(redisKeySendTime);
            System.out.println("邮件发送失败：" + e.getMessage() + e);
            return false;
        }
    }

    /**
     * 带重试机制的邮件发送方法
     * @param email 收件人邮箱
     * @param code 验证码
     * @param maxRetries 最大重试次数
     * @param retryInterval 每次重试的间隔（毫秒）
     */
    private void sendEmailWithRetry(String email, String code, int maxRetries, long retryInterval) throws Exception {
        int retryCount = 0;
        while (retryCount < maxRetries) {
            try {
                // 发送邮件
                emailNotificationSender.sendRegisterCodeEmail(email, code);
                return; // 邮件发送成功，退出重试逻辑
            } catch (Exception e) {
                retryCount++;
                System.out.println("邮件发送失败，第 " + retryCount + " 次重试，错误信息：" + e.getMessage());
                if (retryCount >= maxRetries) {
                    throw e; // 达到最大重试次数后抛出异常
                }
                // 等待一段时间再重试
                try {
                    Thread.sleep(retryInterval);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt(); // 恢复中断状态
                    throw new RuntimeException("邮件发送被中断");
                }
            }
        }
    }

    /**
     * 根据ID获取用户信息
     *
     * @param id 用户ID
     * @return 用户对象
     * @throws CustomException 如果用户不存在
     */
    @Override
    public User getUserById(Long id) {
        // 先从缓存获取
        Object cached = redisUtils.get(USER_CACHE_KEY + id);
        if (cached != null) {
            return (User) cached;
        }
        
        User user = userMapper.selectById(id);
        if (user == null) {
            throw new CustomException("用户不存在");
        }
        
        // 写入缓存
        redisUtils.set(USER_CACHE_KEY + id, user, USER_CACHE_TIME);
        return user;
    }

    /**
     * 用户退出登录
     *
     * @param userId 用户ID
     */
    @Transactional
    @Override
    public void logout(Long userId) {
        // 删除token和用户缓存
        redisUtils.delete(TOKEN_CACHE_KEY + userId);
        redisUtils.delete(USER_CACHE_KEY + userId);
    }

    /**
     * 根据用户名获取用户信息
     *
     * @param username 用户名
     * @return 用户对象
     * @throws CustomException 如果用户不存在
     */
    @Override
    public User getUserByUsername(String username) {
        // 先从缓存获取
        Object cached = redisUtils.get(USER_CACHE_KEY + username);
        if (cached != null) {
            return (User) cached;
        }

        User user = userMapper.selectByUsername(username);
        if (user == null) {
            throw new CustomException("用户不存在");
        }

        // 写入缓存
        redisUtils.set(USER_CACHE_KEY + username, user, USER_CACHE_TIME);
        return user;
    }

    /**
     * 更新用户信息
     *
     * @param id         用户ID
     * @param updateUser 包含要更新字段的用户对象
     * @return 更新后的用户对象
     * @throws CustomException 如果邮箱或手机号已被注册
     */
    @Transactional
    @Override
    public User updateUser(Long id, User updateUser) {
        User user = getUserById(id);

        if (updateUser.getEmail() != null && !user.getEmail().equals(updateUser.getEmail())
                && userMapper.existsByEmail(updateUser.getEmail())) {
            throw new CustomException("邮箱已被注册");
        }

        if (updateUser.getPhone() != null && !user.getPhone().equals(updateUser.getPhone())
                && userMapper.existsByPhone(updateUser.getPhone())) {
            throw new CustomException("手机号已被注册");
        }
        // 更新非空字段
        if (updateUser.getNickname() != null) {
            user.setNickname(updateUser.getNickname());
        }
        if (updateUser.getEmail() != null) {
            user.setEmail(updateUser.getEmail());
        }
        if (updateUser.getPhone() != null) {
            user.setPhone(updateUser.getPhone());
        }
        if (updateUser.getAvatarUrl() != null) {
            user.setAvatarUrl(updateUser.getAvatarUrl());
        }
        userMapper.updateById(user);
        // 更新缓存
        redisUtils.set(USER_CACHE_KEY + id, user, USER_CACHE_TIME);
        return user;
    }


    /**
     * 获取公开的用户信息
     *
     * @param username 用户名
     * @return 用户对象（仅包含公开字段）
     */
    @Override
    public User getPublicUserByUsername(String username) {
        return userMapper.selectByUsername(username);
    }

    /**
     * 获取用户总数
     *
     * @return 用户总数
     */
    @Override
    public Long getUserCount() {
        return userMapper.selectUserCount();
    }

    /**
     * 获取热门用户
     *
     * @return 热门用户列表
     */
    @Override
    public List<User> getPopularUsers() {
        return userMapper.selectPopularUsers();
    }

    /**
     * 搜索公开用户
     *
     * @param keyword 搜索关键字
     * @param page    页码，从1开始
     * @param size    每页大小
     * @return 符合条件的用户列表
     */
    @Override
    public List<User> searchPublicUsers(String keyword, int page, int size) {
        Page<User> userPage = new Page<>(page, size);
        return userMapper.searchPublicUsers(keyword, userPage);
    }

    /**
     * 创建用户
     *
     * @param user 用户对象
     * @return 是否创建成功
     */
    @Override
    @Transactional
    public boolean createUser(User user) {
        // 确保创建的用户字段合法性
        return save(user);
    }

    /**
     * 管理员更新用户信息
     *
     * @param id   用户ID
     * @param user 更新后的用户信息
     * @return 是否更新成功
     */
    @Override
    @Transactional
    public boolean updateUserByAdmin(Long id, User user) {
        // 通过 ID 查找用户并更新
        user.setId(id);
        return updateById(user);
    }

    /**
     * 管理员删除用户
     *
     * @param id 用户ID
     * @return 是否删除成功
     */
    @Override
    @Transactional
    public boolean deleteUserByAdmin(Long id) {
        // 逻辑删除（软删除）或直接删除
        return removeById(id);
    }


    /**
     * 统计指定时间范围内的新增用户数
     *
     * @param startDate 开始日期（可选）
     * @param endDate   结束日期（可选）
     * @return 新增用户数
     */
    @Override
    public Long countNewUsers(String startDate, String endDate) {
        return lambdaQuery()
                .ge(startDate != null, User::getCreatedAt, startDate)
                .le(endDate != null, User::getCreatedAt, endDate)
                .count();
    }

    /**
     * 统计指定时间范围内的活跃用户数
     *
     * @param startDate 开始日期（可选）
     * @param endDate   结束日期（可选）
     * @return 活跃用户数
     */
    @Override
    public Long countActiveUsers(String startDate, String endDate) {
        return lambdaQuery()
                .ge(startDate != null, User::getLastLoginTime, startDate)
                .le(endDate != null, User::getLastLoginTime, endDate)
                .count();
    }

    /**
     * 用户退出登录
     *
     * @param token 用户的Token
     */
    @Override
    @Transactional
    public void logoutUser(String token) {
        // 假设使用 Redis 保存 Token，移除 Token
        redisTemplate.delete("TOKEN_" + token);
    }

    /**
     * 重置用户密码
     *
     * @param emailOrPhone 用户的邮箱或手机号
     * @param newPassword  新密码
     */
    @Override
    public void resetPassword(String emailOrPhone, String newPassword) {
        User user = lambdaQuery()
                .eq(User::getEmail, emailOrPhone)
                .or()
                .eq(User::getPhone, emailOrPhone)
                .one();
        if (user == null) {
            throw new IllegalArgumentException("用户不存在");
        }
        user.setPassword(PasswordEncoder.encode(newPassword)); // 加密密码
        updateById(user);
    }

    /**
     * 用户修改密码
     *
     * @param token       用户的Token
     * @param oldPassword 用户的旧密码
     * @param newPassword 用户的新密码
     */
    @Override
    public void changePassword(String token, String oldPassword, String newPassword) {
        // 获取用户信息
        Long userId = jwtUtils.getUserIdFromToken(token);
        User user = getById(userId);
        if (user == null) {
            throw new IllegalArgumentException("用户不存在");
        }
        // 验证旧密码
        if (!PasswordEncoder.matches(oldPassword, user.getPassword())) {
            throw new IllegalArgumentException("旧密码不正确");
        }
        // 设置新密码
        user.setPassword(PasswordEncoder.encode(newPassword));
        updateById(user);
    }

    /**
     * 上传用户头像
     *
     * @param file  用户上传的头像文件
     * @param token 用户的Token
     * @return 上传后的头像URL
     */
    @Override
    public String uploadAvatar(MultipartFile file, String token) {
        // 上传到云存储或本地存储
        String avatarUrl = fileStorageService.uploadFile(file, "avatars/");

        // 更新用户信息
        Long userId = jwtUtils.getUserIdFromToken(token);
        User user = getById(userId);
        if (user != null) {
            user.setAvatarUrl(avatarUrl);
            updateById(user);
        }

        return avatarUrl;
    }

    /**
     * 用户申请注销账号
     *
     * @param token 用户的Token
     */
    @Override
    @Transactional
    public void requestAccountDeletion(String token) {
        Long userId = jwtUtils.getUserIdFromToken(token);
        User user = getById(userId);
        if (user == null) {
            throw new IllegalArgumentException("用户不存在");
        }
        // 标记为软删除
        user.setDeleted(1);
        updateById(user);
    }

    /**
     * 发送验证码到用户邮箱或手机号
     *
     * @param emailOrPhone 用户的邮箱或手机号
     * @throws MessagingException 如果邮件发送失败
     */
    @Override
    public void sendVerificationCode(String emailOrPhone) throws MessagingException {
        // 生成验证码
        String code = generateRandomCode();
        if (emailOrPhone.contains("@")) {
            // 通过邮箱发送
            emailNotificationSender.sendEmail(emailOrPhone, "验证码", "您的验证码是：" + code);
        } else {
            // 通过短信发送
            smsService.sendSms(emailOrPhone, "您的验证码是：" + code);
        }

        // 保存到 Redis（5 分钟有效）
        redisTemplate.opsForValue().set("VERIFICATION_CODE_" + emailOrPhone, code, 5, TimeUnit.MINUTES);
    }


    @Override
    public void verifyCode(String emailOrPhone, String code) {
        String storedCode = (String) redisTemplate.opsForValue().get("VERIFICATION_CODE_" + emailOrPhone);
        if (storedCode == null || !storedCode.equals(code)) {
            throw new IllegalArgumentException("验证码错误或已过期");
        }

        // 验证通过，删除验证码
        redisTemplate.delete("VERIFICATION_CODE_" + emailOrPhone);
    }

    @Override
    public Map<String, Object> getUserStatistics(String token) {
        Long userId = jwtUtils.getUserIdFromToken(token);
        Map<String, Object> stats = new HashMap<>();
        stats.put("totalUsers", count());
        stats.put("activeUsers", lambdaQuery().eq(User::getStatus, 1).count());
//        stats.put("loginCount", operationLogService.getLoginCountByUserId(userId));
//        stats.put("lastLogin", operationLogService.getLastLoginTimeByUserId(userId));
        return stats;
    }


    @Override
    public void bindThirdPartyAccount(String token, ThirdPartyAccount account) {
        Long userId = jwtUtils.getUserIdFromToken(token);
        ThirdPartyAccount existing = thirdPartyAccountService.getByUserIdAndPlatform(userId, account.getPlatform());
        if (existing != null) {
            throw new IllegalArgumentException("该平台账号已绑定");
        }
        account.setUserId(userId);
        thirdPartyAccountService.save(account);
    }

    @Override
    public void unbindThirdPartyAccount(String token, String platform) {
        Long userId = jwtUtils.getUserIdFromToken(token);
        boolean success = thirdPartyAccountService.removeByUserIdAndPlatform(userId, platform);
        if (!success) {
            throw new IllegalArgumentException("解绑失败，未找到对应的绑定信息");
        }
    }



    @Override
    public void enableTwoFactorAuth(String token, String secretKey) {
        Long userId = jwtUtils.getUserIdFromToken(token);
        User user = getById(userId);
        if (user == null) {
            throw new IllegalArgumentException("用户不存在");
        }
//        user.setTwoFactorSecret(secretKey);
//        user.setTwoFactorEnabled(true);
        updateById(user);
    }


    @Override
    public void verifyTwoFactorAuth(String token, String verificationCode) {
        Long userId = jwtUtils.getUserIdFromToken(token);
        User user = getById(userId);
//        if (user == null || !user.getTwoFactorEnabled()) {
//            throw new IllegalArgumentException("双因素认证未启用");
//        }

        // 验证码校验逻辑
//        if (!twoFactorAuthService.verifyCode(user.getTwoFactorSecret(), verificationCode)) {
//            throw new IllegalArgumentException("双因素认证验证码错误");
//        }
    }


    /**
     * 生成安全的六位验证码
     * @return
     */
    private String generateRandomCode() {
        SecureRandom random = new SecureRandom();
        int length = 6; // 验证码长度
        StringBuilder sb = new StringBuilder(length);
        String chars = "0123456789"; // 可扩展为字母和数字组合，如 "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        for (int i = 0; i < length; i++) {
            sb.append(chars.charAt(random.nextInt(chars.length())));
        }
        return sb.toString();
    }

    /**
     * 构建md5加密的redis-key
     * @param email
     * @param prefix
     * @return
     */
    private String generateRedisKey(String email, String prefix) {
        String hashedEmail = DigestUtils.md5DigestAsHex(email.getBytes(StandardCharsets.UTF_8)); // 使用 Spring 提供的 MD5 工具
        return prefix + hashedEmail;
    }

    private static String generateRandomNickname() {
        String baseName = "食光客";
        int randomNum = new Random().nextInt(90000);
        return baseName + randomNum;
    }

    /**
     * 验证邮箱格式是否正确
     *
     * @param email 邮箱地址
     * @return 是否为合法邮箱
     */
    private boolean isValidEmail(String email) {
        String emailRegex = "^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+$";
        return email != null && email.matches(emailRegex);
    }

    public boolean validateToken(String token) {
        Long userId = jwtUtils.getUserIdFromToken(token);
        if (userId == null) {
            return false;
        }

        // 检查token是否在缓存中
        Object cachedToken = redisUtils.get(TOKEN_CACHE_KEY + userId);
        return token.equals(cachedToken);
    }

} 