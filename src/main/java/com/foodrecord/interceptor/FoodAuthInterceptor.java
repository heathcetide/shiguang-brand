package com.foodrecord.interceptor;

import com.foodrecord.common.auth.AuthContext;
import com.foodrecord.common.auth.TokenService;
import com.foodrecord.common.exception.UnauthorizedException;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

@Component("foodAuthInterceptor")
public class FoodAuthInterceptor implements HandlerInterceptor {
    @Autowired
    @Qualifier("foodUserService")
    private UserService userService;

    private final TokenService tokenService;

    public FoodAuthInterceptor(TokenService tokenService) {
        this.tokenService = tokenService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String token = request.getHeader("Authorization");
        if (token == null ) {
            throw new UnauthorizedException("未登录或token已过期");
        }
        // 验证token
        if (token.startsWith("Bearer ")){
            token = token.substring(7);
        }
        if (!tokenService.validateToken(token)) {
            throw new UnauthorizedException("token无效或已过期");
        }

        Long userId = tokenService.getUserIdFromToken(token);
        User user = userService.getById(userId);
        if (user == null || user.getStatus() == 3 || user.getStatus() == 4) {
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