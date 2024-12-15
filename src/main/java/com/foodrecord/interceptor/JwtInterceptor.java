package com.foodrecord.interceptor;

import com.foodrecord.common.exception.CustomException;
import com.foodrecord.common.utils.JwtUtils;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

@Component
public class JwtInterceptor implements HandlerInterceptor {

    private final JwtUtils jwtUtils;

    public JwtInterceptor(JwtUtils jwtUtils) {
        this.jwtUtils = jwtUtils;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // 从请求头中获取token
        String token = request.getHeader("Authorization");
        if (token == null || !token.startsWith("Bearer ")) {
            throw new CustomException("未登录或token已过期");
        }

        // 验证token
        token = token.substring(7);
        if (!jwtUtils.validateToken(token)) {
            throw new CustomException("token无效");
        }

        // 将用户信息存入request
        String username = jwtUtils.getUsernameFromToken(token);
        request.setAttribute("username", username);

        return true;
    }
} 