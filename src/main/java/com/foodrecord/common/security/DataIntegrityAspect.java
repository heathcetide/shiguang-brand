package com.foodrecord.common.security;

import com.foodrecord.common.exception.DataIntegrityException;
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
 * 数据完整性校验切面
 * 
 * @author yourname
 * @since 1.0.0
 */
@Aspect
@Component
public class DataIntegrityAspect {
    private final DataIntegrityUtils integrityUtils;
    private final ObjectMapper objectMapper;
    
    private static final String CHECKSUM_HEADER = "X-Data-Checksum";

    public DataIntegrityAspect(DataIntegrityUtils integrityUtils, ObjectMapper objectMapper) {
        this.integrityUtils = integrityUtils;
        this.objectMapper = objectMapper;
    }

    @Around("@annotation(com.foodrecord.common.security.DataIntegrity)")
    public Object around(ProceedingJoinPoint point) throws Throwable {
        HttpServletRequest request = ((ServletRequestAttributes) RequestContextHolder
            .getRequestAttributes()).getRequest();
            
        MethodSignature signature = (MethodSignature) point.getSignature();
        Method method = signature.getMethod();
        DataIntegrity integrity = method.getAnnotation(DataIntegrity.class);
        
        // 获取请求体数据
        String requestBody = objectMapper.writeValueAsString(point.getArgs()[0]);
        
        // 获取校验值
        String checksum = request.getHeader(CHECKSUM_HEADER);
        if (checksum == null) {
            throw new DataIntegrityException("缺少数据完整性校验值");
        }
        
        // 验证数据完整性
        boolean isValid;
        if (integrity.includeTimestamp()) {
            isValid = integrityUtils.verifyIntegrityWithTimestamp(
                requestBody, 
                checksum, 
                integrity.algorithm(), 
                integrity.secretKey(),
                300000 // 5分钟有效期
            );
        } else {
            isValid = integrityUtils.verifyIntegrity(
                requestBody,
                checksum,
                integrity.algorithm(),
                integrity.secretKey()
            );
        }
        
        if (!isValid) {
            throw new DataIntegrityException(integrity.message());
        }
        
        return point.proceed();
    }
} 