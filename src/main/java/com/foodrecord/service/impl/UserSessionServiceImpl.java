package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.UserSessionMapper;
import com.foodrecord.model.entity.UserSession;
import com.foodrecord.service.UserSessionService;
import org.springframework.stereotype.Service;

@Service
public class UserSessionServiceImpl extends ServiceImpl<UserSessionMapper, UserSession>
        implements UserSessionService {
    @Override
    public void invalidateByToken(String token) {
        // 根据 sessionToken 查找并删除记录
        baseMapper.deleteByToken(token);
    }
}
