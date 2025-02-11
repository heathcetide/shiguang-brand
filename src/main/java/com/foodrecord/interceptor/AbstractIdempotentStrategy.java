package com.foodrecord.interceptor;

import com.foodrecord.common.security.Idempotent;
import com.foodrecord.exception.UnauthorizedException;

import javax.servlet.http.HttpServletRequest;
import java.io.IOException;

public abstract class AbstractIdempotentStrategy implements IdempotentStrategy {

    protected abstract void validateRequest(HttpServletRequest request, String token, Idempotent methodAnnotation, int timeout, int expire) throws UnauthorizedException, IOException;

    @Override
    public final void handle(HttpServletRequest request, String token, Idempotent methodAnnotation, int timeout, int expire) throws UnauthorizedException, IOException {
        validateRequest(request, token, methodAnnotation, timeout, expire);
    }
}