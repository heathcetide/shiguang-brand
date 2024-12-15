package com.foodrecord.common.security;

import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * CSRF防护过滤器
 */
<<<<<<< HEAD
//@Component
=======
@Component
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
@Order(2)
public class CsrfFilter extends OncePerRequestFilter {
    private final CsrfTokenRepository tokenRepository;
    
    private static final Set<String> SAFE_METHODS = new HashSet<>(
        Arrays.asList("GET", "HEAD", "TRACE", "OPTIONS")
    );

    public CsrfFilter(CsrfTokenRepository tokenRepository) {
        this.tokenRepository = tokenRepository;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        
        if (requiresCsrfProtection(request)) {
            String sessionId = request.getSession().getId();
            String token = request.getHeader("X-CSRF-TOKEN");
            
            if (!tokenRepository.validateToken(sessionId, token)) {
                throw new SecurityException("CSRF Token无效");
            }
        }
        
        // 为响应添加新的CSRF Token
        String sessionId = request.getSession().getId();
        String newToken = tokenRepository.generateToken(sessionId);
        response.setHeader("X-CSRF-TOKEN", newToken);
        
        filterChain.doFilter(request, response);
    }
    
    /**
     * 判断请求是否需要CSRF保护
     */
    private boolean requiresCsrfProtection(HttpServletRequest request) {
        return !SAFE_METHODS.contains(request.getMethod());
    }
} 