package com.foodrecord.common.security;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * XSS防护过滤器
 * 对所有请求进行XSS过滤，防止XSS攻击
 */
//@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class XssFilter extends OncePerRequestFilter {
    
    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        
        // 包装请求，对参数进行XSS过滤
        XssHttpServletRequestWrapper xssRequest = 
            new XssHttpServletRequestWrapper(request);
        
        // 添加安全响应头
        response.setHeader("X-XSS-Protection", "1; mode=block");
        response.setHeader("X-Content-Type-Options", "nosniff");
        
        filterChain.doFilter(xssRequest, response);
    }
} 