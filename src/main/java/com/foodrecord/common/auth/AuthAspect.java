package com.foodrecord.common.auth;

import com.foodrecord.common.exception.UnauthorizedException;
import com.foodrecord.model.entity.user.User;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;

@Aspect
@Component
public class AuthAspect {
    private final ObjectMapper objectMapper;

    public AuthAspect(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Before("@annotation(requirePermission)")
    public void checkPermission(JoinPoint point, RequirePermission requirePermission) {
        User currentUser = AuthContext.getCurrentUser();
        if (currentUser == null) {
            throw new UnauthorizedException("未登录");
        }

//        List<String> userPermissions = parsePermissions(currentUser.getPermissions());

        List<String> userPermissions = parsePermissions(currentUser.getAvatarUrl());

//        List<String> userPermissions = parsePermissions(currentUser.getPermissions());
        String[] requiredPermissions = requirePermission.value();
        boolean requireAll = requirePermission.requireAll();

        if (requireAll) {
            if (!userPermissions.containsAll(Arrays.asList(requiredPermissions))) {
                throw new UnauthorizedException("权限不足");
            }
        } else {
            boolean hasAnyPermission = Arrays.stream(requiredPermissions)
                    .anyMatch(userPermissions::contains);
            if (!hasAnyPermission) {
                throw new UnauthorizedException("权限不足");
            }
        }
    }

    @Before("@annotation(requireRole)")
    public void checkRole(JoinPoint point, RequireRole requireRole) {
        User currentUser = AuthContext.getCurrentUser();
        if (currentUser == null) {
            throw new UnauthorizedException("未登录");
        }

        String userRole = currentUser.getRole();
        String[] requiredRoles = requireRole.value();
        boolean requireAll = requireRole.requireAll();

        if (requireAll) {
            if (!Arrays.asList(requiredRoles).contains(userRole)) {
                throw new UnauthorizedException("角色权限不足");
            }
        } else {
            boolean hasAnyRole = Arrays.stream(requiredRoles)
                    .anyMatch(role -> role.equals(userRole));
            if (!hasAnyRole) {
                throw new UnauthorizedException("角色权限不足");
            }
        }
    }

    private List<String> parsePermissions(String permissionsJson) {
        try {
            return objectMapper.readValue(permissionsJson, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }
} 