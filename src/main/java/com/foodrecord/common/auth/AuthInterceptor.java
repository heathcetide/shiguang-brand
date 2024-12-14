package com.foodrecord.common.auth;

import com.foodrecord.common.exception.UnauthorizedException;
import com.foodrecord.model.entity.User;
import com.foodrecord.service.UserService;
import com.foodrecord.service.impl.UserServiceImpl;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

@Component
public class AuthInterceptor implements HandlerInterceptor {
    @Autowired
    private UserService userService;

    private final TokenService tokenService;

    public AuthInterceptor(TokenService tokenService) {
        this.tokenService = tokenService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String token = request.getHeader("Authorization");
        if (token == null || !token.startsWith("Bearer ")) {
            throw new UnauthorizedException("未登录或token已过期");
        }

        token = token.substring(7);
        if (!tokenService.validateToken(token)) {
            throw new UnauthorizedException("token无效或已过期");
        }

        Long userId = tokenService.getUserIdFromToken(token);
        User user = userService.getById(userId);
        if (user == null || user.getStatus() != 2) {
            throw new UnauthorizedException("账号不可用");
        }

        AuthContext.setCurrentUser(user);
        AuthContext.setCurrentToken(token);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        AuthContext.clear();
    }
} 