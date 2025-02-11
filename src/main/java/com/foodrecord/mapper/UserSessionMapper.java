package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.UserSession;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface UserSessionMapper extends BaseMapper<UserSession> {

    /**
     * 根据 token 删除会话记录
     * @param token 会话的 token
     */
    @Delete("DELETE FROM user_sessions WHERE session_token = #{token}")
    void deleteByToken(String token);
}
