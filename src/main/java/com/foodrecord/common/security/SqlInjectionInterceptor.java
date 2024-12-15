package com.foodrecord.common.security;

import com.baomidou.mybatisplus.core.toolkit.StringUtils;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.util.regex.Pattern;

/**
 * SQL注入防护拦截器
 * 对请求参数进行SQL注入检查
 */
@Component
public class SqlInjectionInterceptor implements HandlerInterceptor {
    
    // SQL注入检测正则表达式
    private static final Pattern SQL_INJECTION_PATTERN = Pattern.compile(
        "(?i).*?((\\b(select|update|delete|insert|truncate|drop|alter)\\b)|" +
        "(\\b(and|or)\\b.+?(>|<|=|in|like)\\b)|" +
        "(\\b(union).+?(select)\\b))"
    );
    
    @Override
    public boolean preHandle(HttpServletRequest request, 
                           HttpServletResponse response, 
                           Object handler) {
        // 检查查询参数
        String queryString = request.getQueryString();
        if (StringUtils.isNotBlank(queryString)) {
            checkSqlInjection(queryString);
        }
        
        // 检查所有参数值
        request.getParameterMap().forEach((key, values) -> {
            for (String value : values) {
                checkSqlInjection(value);
            }
        });
        
        return true;
    }
    
    /**
     * 检查SQL注入
     * @param value 待检查的值
     * @throws SecurityException 如果检测到SQL注入
     */
    private void checkSqlInjection(String value) {
        if (StringUtils.isNotBlank(value) && 
            SQL_INJECTION_PATTERN.matcher(value).matches()) {
            throw new SecurityException("检测到SQL注入攻击");
        }
    }
} 