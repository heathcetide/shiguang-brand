package com.foodrecord.common.security;

import com.foodrecord.common.auth.AuthContext;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.service.impl.SensitiveOperationLogServiceImpl;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import javax.servlet.http.HttpServletRequest;
import java.lang.reflect.Method;

/**
 * 操作审计日志切面
 * 自动记录被@AuditLog注解标记的方法的执行情况
 * 
 * @author yourname
 * @since 1.0.0
 */
@Aspect
@Component
public class AuditLogAspect {
    private final SensitiveOperationLogServiceImpl logService;
    private final ObjectMapper objectMapper;

    public AuditLogAspect(SensitiveOperationLogServiceImpl logService, ObjectMapper objectMapper) {
        this.logService = logService;
        this.objectMapper = objectMapper;
    }

    @Around("@annotation(com.foodrecord.common.security.AuditLog)")
    public Object around(ProceedingJoinPoint point) throws Throwable {
        // 获取当前请求
        HttpServletRequest request = ((ServletRequestAttributes) RequestContextHolder
            .getRequestAttributes()).getRequest();
            
        // 获取当前用户
        User currentUser = AuthContext.getCurrentUser();
        if (currentUser == null) {
            return point.proceed();
        }
        
        // 获取注解信息
        MethodSignature signature = (MethodSignature) point.getSignature();
        Method method = signature.getMethod();
        AuditLog auditLog = method.getAnnotation(AuditLog.class);
        
        // 准备记录日志
        String operation = auditLog.operation();
        String description = auditLog.description();
        String params = auditLog.recordParams() ? objectMapper.writeValueAsString(point.getArgs()) : null;
        
        Object result = null;
        String errorMsg = null;
        try {
            // 执行原方法
            result = point.proceed();
            
            // 记录成功日志
            logService.logOperation(
                currentUser.getId(),
                operation,
                String.format("%s - 参数: %s, 结果: %s", 
                    description,
                    params,
                    auditLog.recordResult() ? objectMapper.writeValueAsString(result) : "已忽略"
                ),
                request,
                "SUCCESS",
                null
            );
            
            return result;
        } catch (Throwable e) {
            // 记录异常日志
            errorMsg = auditLog.recordException() ? e.getMessage() : "异常详情已忽略";
            logService.logOperation(
                currentUser.getId(),
                operation,
                String.format("%s - 参数: %s, 异常: %s", 
                    description,
                    params,
                    errorMsg
                ),
                request,
                "FAILED",
                errorMsg
            );
            throw e;
        }
    }
} 