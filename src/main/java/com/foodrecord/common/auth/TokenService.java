package com.foodrecord.common.auth;

import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.model.entity.User;
import com.foodrecord.model.entity.UserSession;
import com.foodrecord.service.UserSessionService;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.time.LocalDateTime;
import java.util.Date;
import java.util.UUID;

@Service
public class TokenService {
    private final RedisUtils redisUtils;

    @Resource
    private UserSessionService sessionService;

    @Value("${jwt.secret}")
    private String secret;

    @Value("${jwt.expiration}")
    private Long expiration;

    public TokenService(RedisUtils redisUtils) {
        this.redisUtils = redisUtils;
    }

    public String generateToken(User user, String deviceId, String deviceType, String ipAddress, String userAgent) {
        String token = Jwts.builder()
                .setSubject(user.getId().toString())
                .setIssuedAt(new Date())
                .setExpiration(new Date(System.currentTimeMillis() + expiration))
                .signWith(SignatureAlgorithm.HS512, secret)
                .compact();

        // 创建会话记录
        UserSession session = new UserSession();
        session.setUserId(user.getId());
        session.setSessionToken(token);
        session.setRefreshToken(UUID.randomUUID().toString());
        session.setDeviceId(deviceId);
        session.setDeviceType(deviceType);
        session.setIpAddress(ipAddress);
        session.setUserAgent(userAgent);
        session.setExpiresAt(LocalDateTime.now().plusSeconds(expiration / 1000));
        sessionService.save(session);

        // 缓存token
        redisUtils.set("token:" + token, user.getId(), expiration / 1000);
        
        return token;
    }

    public boolean validateToken(String token) {
        try {
            Object userId = redisUtils.get("token:" + token);
            if (userId == null) {
                return false;
            }
            
            Claims claims = Jwts.parser()
                    .setSigningKey(secret)
                    .parseClaimsJws(token)
                    .getBody();
            
            return claims.getExpiration().after(new Date());
        } catch (Exception e) {
            return false;
        }
    }

    public Long getUserIdFromToken(String token) {
        try {
            Claims claims = Jwts.parser()
                    .setSigningKey(secret)
                    .parseClaimsJws(token)
                    .getBody();
            
            return Long.parseLong(claims.getSubject());
        } catch (Exception e) {
            return null;
        }
    }

    public void invalidateToken(String token) {
        redisUtils.delete("token:" + token);
        sessionService.invalidateByToken(token);
    }
} 