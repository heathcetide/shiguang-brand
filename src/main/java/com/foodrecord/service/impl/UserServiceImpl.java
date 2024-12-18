package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.common.utils.JwtUtils;
import com.foodrecord.common.utils.PasswordEncoder;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.UserMapper;
import com.foodrecord.model.dto.LoginRequest;
import com.foodrecord.model.dto.RegisterRequest;
<<<<<<< HEAD
<<<<<<< HEAD
import com.foodrecord.model.entity.ThirdPartyAccount;
import com.foodrecord.model.entity.User;
import com.foodrecord.notification.EmailService;
import com.foodrecord.notification.FileStorageService;
import com.foodrecord.notification.SmsService;
import com.foodrecord.service.ThirdPartyAccountService;
import com.foodrecord.service.UserService;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
=======
=======
import com.foodrecord.model.entity.ThirdPartyAccount;
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
import com.foodrecord.model.entity.User;
import com.foodrecord.notification.impl.EmailNotificationSender;
import com.foodrecord.notification.FileStorageService;
import com.foodrecord.notification.SmsService;
import com.foodrecord.service.ThirdPartyAccountService;
import com.foodrecord.service.UserService;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
<<<<<<< HEAD
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
import javax.mail.MessagingException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2

@Service
public class UserServiceImpl extends ServiceImpl<UserMapper, User> implements UserService {
    @Resource
    private UserMapper userMapper;
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2

    @Resource
    private ThirdPartyAccountService thirdPartyAccountService;

    @Resource
<<<<<<< HEAD
    private EmailService emailService;
=======
    private EmailNotificationSender emailService;
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2

    @Resource
    private FileStorageService fileStorageService;

    @Resource
    private SmsService smsService;

    @Resource
    private JwtUtils jwtUtils;

    @Resource
    private RedisUtils redisUtils;
<<<<<<< HEAD
=======
    private final JwtUtils jwtUtils;
    private final RedisUtils redisUtils;
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
    
    private static final String USER_CACHE_KEY = "user:";
    private static final String TOKEN_CACHE_KEY = "token:";
    private static final long USER_CACHE_TIME = 3600; // 1小时
    private static final long TOKEN_CACHE_TIME = 86400; // 24小时

<<<<<<< HEAD
<<<<<<< HEAD
    @Resource
    private RedisTemplate<String, Object> redisTemplate;

=======
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
    @Resource
    private RedisTemplate<String, Object> redisTemplate;

>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
    public UserServiceImpl(JwtUtils jwtUtils, RedisUtils redisUtils) {
        this.jwtUtils = jwtUtils;
        this.redisUtils = redisUtils;
    }

    @Override
    public String login(LoginRequest request) {
        User user = userMapper.selectByUsername(request.getUsername());
        if (user == null || !PasswordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new CustomException("用户名或密码错误");
        }

        String token = jwtUtils.generateToken(String.valueOf(user.getId()));
        // 缓存token和用户信息
        redisUtils.set(TOKEN_CACHE_KEY + user.getId(), token, TOKEN_CACHE_TIME);
        redisUtils.set(USER_CACHE_KEY + user.getId(), user, USER_CACHE_TIME);
        
        return token;
    }

    @Transactional
    @Override
    public User register(RegisterRequest request) {
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
        user.setStatus(1);

        userMapper.insert(user);
        // 缓存用户信息
        redisUtils.set(USER_CACHE_KEY + user.getId(), user, USER_CACHE_TIME);
        return user;
    }

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

    @Transactional
    @Override
    public void logout(Long userId) {
        // 删除token和用户缓存
        redisUtils.delete(TOKEN_CACHE_KEY + userId);
        redisUtils.delete(USER_CACHE_KEY + userId);
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
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2

    @Override
    @Transactional
    public boolean createUser(User user) {
        // 确保创建的用户字段合法性
        return save(user);
    }

    @Override
    @Transactional
    public boolean updateUserByAdmin(Long id, User user) {
        // 通过 ID 查找用户并更新
        user.setId(id);
        return updateById(user);
    }

    @Override
    @Transactional
    public boolean deleteUserByAdmin(Long id) {
        // 逻辑删除（软删除）或直接删除
        return removeById(id);
    }

    @Override
    public Long countNewUsers(String startDate, String endDate) {
        return lambdaQuery()
                .ge(startDate != null, User::getCreatedAt, startDate)
                .le(endDate != null, User::getCreatedAt, endDate)
                .count();
    }

    @Override
    public Long countActiveUsers(String startDate, String endDate) {
        return lambdaQuery()
                .ge(startDate != null, User::getLastLoginTime, startDate)
                .le(endDate != null, User::getLastLoginTime, endDate)
                .count();
    }

    @Override
    public void logoutUser(String token) {
        // 假设使用 Redis 保存 Token，移除 Token
        redisTemplate.delete("TOKEN_" + token);
    }

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

    @Override
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


    @Override
<<<<<<< HEAD
    public void sendVerificationCode(String emailOrPhone) {
=======
    public void sendVerificationCode(String emailOrPhone) throws MessagingException {
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
        // 生成验证码
        String code = generateRandomCode();
        if (emailOrPhone.contains("@")) {
            // 通过邮箱发送
            emailService.sendEmail(emailOrPhone, "验证码", "您的验证码是：" + code);
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
    public List<User> searchPublicUsers(String keyword) {
        return lambdaQuery()
                .like(User::getUsername, keyword)
                .or()
                .like(User::getNickname, keyword)
                .select(User::getId, User::getUsername, User::getNickname, User::getAvatarUrl)
                .list();
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

    private String generateRandomCode() {
        return String.valueOf((int) (Math.random() * 900000) + 100000); // 生成6位随机数
    }

<<<<<<< HEAD
=======
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
} 