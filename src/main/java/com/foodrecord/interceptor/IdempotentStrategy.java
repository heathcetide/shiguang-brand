package com.foodrecord.interceptor;

import com.foodrecord.common.security.Idempotent;
import com.foodrecord.exception.UnauthorizedException;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;

public interface IdempotentStrategy {

    void handle(HttpServletRequest request, String token, Idempotent methodAnnotation, int timeout, int expire) throws UnauthorizedException, IOException;

}