package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.common.utils.JwtUtils;
import com.foodrecord.common.utils.PasswordEncoder;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.UserMapper;
import com.foodrecord.model.dto.LoginRequest;
import com.foodrecord.model.dto.RegisterRequest;
import com.foodrecord.model.entity.User;
import com.foodrecord.service.UserService;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;

@Service
public class UserServiceImpl extends ServiceImpl<UserMapper, User> implements UserService {
    @Resource
    private UserMapper userMapper;
    private final JwtUtils jwtUtils;
    private final RedisUtils redisUtils;
    
    private static final String USER_CACHE_KEY = "user:";
    private static final String TOKEN_CACHE_KEY = "token:";
    private static final long USER_CACHE_TIME = 3600; // 1小时
    private static final long TOKEN_CACHE_TIME = 86400; // 24小时

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
} 