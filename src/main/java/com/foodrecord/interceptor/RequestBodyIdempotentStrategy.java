package com.foodrecord.interceptor;

import com.foodrecord.cache.CacheStrategy;
import com.foodrecord.common.security.Idempotent;
import com.foodrecord.exception.UnauthorizedException;
import javax.servlet.http.HttpServletRequest;
import org.apache.commons.codec.digest.DigestUtils;

import java.io.IOException;
import java.util.stream.Collectors;

public class RequestBodyIdempotentStrategy extends AbstractIdempotentStrategy {

    private final CacheStrategy cacheStrategy;

    public RequestBodyIdempotentStrategy(CacheStrategy cacheStrategy) {
        this.cacheStrategy = cacheStrategy;
    }

    @Override
    protected void validateRequest(HttpServletRequest request, String token, Idempotent methodAnnotation, int timeout, int expire) throws UnauthorizedException, IOException {
        // 假设请求体是 JSON 格式，使用请求体的哈希值作为幂等性标识
        String requestBody = request.getReader().lines().collect(Collectors.joining(System.lineSeparator()));
        String redisKey = methodAnnotation.prefix() + DigestUtils.md5Hex(token + requestBody);
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