package com.foodrecord.common.security;

import com.foodrecord.common.exception.IdempotentException;
import com.foodrecord.common.utils.RedisUtils;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import javax.servlet.http.HttpServletRequest;
import java.lang.reflect.Method;
import java.util.UUID;

/**
 * 接口幂等性切面
 * 
 * @author yourname
 * @since 1.0.0
 */
@Aspect
@Component
public class IdempotentAspect {
    private final RedisUtils redisUtils;
    
    private static final String IDEMPOTENT_KEY_PREFIX = "idempotent:";
    private static final String IDEMPOTENT_HEADER_NAME = "X-Idempotent-Token";
    private static final String IDEMPOTENT_PARAM_NAME = "idempotentToken";

    public IdempotentAspect(RedisUtils redisUtils) {
        this.redisUtils = redisUtils;
    }

    @Around("@annotation(com.foodrecord.common.security.Idempotent)")
    public Object around(ProceedingJoinPoint point) throws Throwable {
        HttpServletRequest request = ((ServletRequestAttributes) RequestContextHolder
            .getRequestAttributes()).getRequest();
            
        MethodSignature signature = (MethodSignature) point.getSignature();
        Method method = signature.getMethod();
        Idempotent idempotent = method.getAnnotation(Idempotent.class);
        
        // 获取幂等性标识
        String token = getIdempotentToken(request, idempotent.type());
        if (token == null) {
            throw new IdempotentException("幂等性标识不能为空");
        }
        
        // 构建Redis键
        String key = IDEMPOTENT_KEY_PREFIX + token;
        
        // 尝试获取锁
        boolean locked = redisUtils.setIfAbsent(key, "1", idempotent.timeout());
        if (!locked) {
            throw new IdempotentException(idempotent.message());
        }
        
        try {
            return point.proceed();
        } finally {
            // 方法执行完成后删除标识
            redisUtils.delete(key);
        }
    }
    
    /**
     * 获取幂等性标识
     */
    private String getIdempotentToken(HttpServletRequest request, IdempotentType type) {
        String token = null;
        switch (type) {
            case HEADER:
                token = request.getHeader(IDEMPOTENT_HEADER_NAME);
                break;
            case PARAM:
                token = request.getParameter(IDEMPOTENT_PARAM_NAME);
                break;
            case BODY:
                // 从请求体获取标识的逻辑需要根据具体情况实现
                break;
            case AUTO:
                token = UUID.randomUUID().toString();
                break;
        }
        return token;
    }
} 