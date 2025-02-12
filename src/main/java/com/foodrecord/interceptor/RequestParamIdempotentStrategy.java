package com.foodrecord.interceptor;

import com.foodrecord.common.cache.CacheStrategy;
import com.foodrecord.common.security.Idempotent;
import com.foodrecord.exception.UnauthorizedException;

import javax.servlet.http.HttpServletRequest;
import org.apache.commons.codec.digest.DigestUtils;

public class RequestParamIdempotentStrategy extends AbstractIdempotentStrategy {

    private final CacheStrategy cacheStrategy;

    public RequestParamIdempotentStrategy(CacheStrategy cacheStrategy) {
        this.cacheStrategy = cacheStrategy;
    }

    @Override
    protected void validateRequest(HttpServletRequest request, String token, Idempotent methodAnnotation, int timeout, int expire) throws UnauthorizedException {
        String identifier = methodAnnotation.identifier();
        String requestParam = request.getParameter(identifier.isEmpty() ? "id" : identifier); // 使用指定的标识
        String redisKey = methodAnnotation.prefix() + DigestUtils.md5Hex(token + requestParam);
        long currentTime = System.currentTimeMillis();
        long lastRequestTime = (Long) cacheStrategy.get(redisKey + ":lastRequestTime");

        // 防抖和节流逻辑
        if (currentTime - lastRequestTime < timeout * 1000) {
            throw new UnauthorizedException(methodAnnotation.message());
        }

        // 更新请求时间
        cacheStrategy.put(redisKey + ":lastRequestTime", currentTime, timeout);

        if (cacheStrategy.exists(redisKey)) {
            throw new UnauthorizedException("请勿重复提交");
        } else {
            cacheStrategy.put(redisKey, request.getRequestURI(), expire);
        }
    }
} 