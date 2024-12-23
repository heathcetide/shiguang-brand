package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.user.UserSession;

public interface UserSessionService extends IService<UserSession> {
    /**
     * 根据 token 使会话失效
     * @param token 会话的 token
     */
    void invalidateByToken(String token);
}
