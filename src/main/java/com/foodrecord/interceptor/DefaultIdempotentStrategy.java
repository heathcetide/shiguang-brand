package com.foodrecord.interceptor;

import com.foodrecord.cache.CacheStrategy;
import com.foodrecord.common.security.Idempotent;
import com.foodrecord.exception.UnauthorizedException;
import org.apache.commons.codec.digest.DigestUtils;

import javax.servlet.http.HttpServletRequest;
import java.util.concurrent.TimeUnit;

public class DefaultIdempotentStrategy extends AbstractIdempotentStrategy {

    private final CacheStrategy cacheStrategy;

    public DefaultIdempotentStrategy(CacheStrategy cacheStrategy) {
        this.cacheStrategy = cacheStrategy;
    }

    @Override
    protected void validateRequest(HttpServletRequest request, String token, Idempotent methodAnnotation, int timeout, int expire) throws UnauthorizedException {
        String redisKey = methodAnnotation.prefix() + DigestUtils.md5Hex(token);
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