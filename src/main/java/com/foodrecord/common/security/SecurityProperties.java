package com.foodrecord.common.security;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 安全配置属性类
 * 用于从配置文件中加载安全相关的配置
 * 
 * @author yourname
 * @since 1.0.0
 */
@Component
@ConfigurationProperties(prefix = "security")
public class SecurityProperties {
    /**
     * 密码相关配置
     */
    private PasswordConfig password = new PasswordConfig();
    
    /**
     * 登录相关配置
     */
    private LoginConfig login = new LoginConfig();
    
    /**
     * 加密相关配置
     */
    private EncryptionConfig encryption = new EncryptionConfig();
    
    /**
     * JWT相关配置
     */
    private JwtConfig jwt = new JwtConfig();

    public static class PasswordConfig {
        private int minLength = 8;
        private int maxLength = 20;
        private boolean requireUppercase = true;
        private boolean requireLowercase = true;
        private boolean requireDigit = true;
        private boolean requireSpecial = true;
        private int maxRepeatedChars = 3;
        private int historySize = 5;
        private int expirationDays = 90;
        private String specialChars = "!@#$%^&*()_+-=[]{}|;:,.<>?";

        public int getMinLength() {
            return minLength;
        }

        public void setMinLength(int minLength) {
            this.minLength = minLength;
        }

        public int getMaxLength() {
            return maxLength;
        }

        public void setMaxLength(int maxLength) {
            this.maxLength = maxLength;
        }

        public boolean isRequireUppercase() {
            return requireUppercase;
        }

        public void setRequireUppercase(boolean requireUppercase) {
            this.requireUppercase = requireUppercase;
        }

        public boolean isRequireLowercase() {
            return requireLowercase;
        }

        public void setRequireLowercase(boolean requireLowercase) {
            this.requireLowercase = requireLowercase;
        }

        public boolean isRequireDigit() {
            return requireDigit;
        }

        public void setRequireDigit(boolean requireDigit) {
            this.requireDigit = requireDigit;
        }

        public boolean isRequireSpecial() {
            return requireSpecial;
        }

        public void setRequireSpecial(boolean requireSpecial) {
            this.requireSpecial = requireSpecial;
        }

        public int getMaxRepeatedChars() {
            return maxRepeatedChars;
        }

        public void setMaxRepeatedChars(int maxRepeatedChars) {
            this.maxRepeatedChars = maxRepeatedChars;
        }

        public int getHistorySize() {
            return historySize;
        }

        public void setHistorySize(int historySize) {
            this.historySize = historySize;
        }

        public int getExpirationDays() {
            return expirationDays;
        }

        public void setExpirationDays(int expirationDays) {
            this.expirationDays = expirationDays;
        }

        public String getSpecialChars() {
            return specialChars;
        }

        public void setSpecialChars(String specialChars) {
            this.specialChars = specialChars;
        }
    }

    public PasswordConfig getPassword() {
        return password;
    }

    public void setPassword(PasswordConfig password) {
        this.password = password;
    }

    public LoginConfig getLogin() {
        return login;
    }

    public void setLogin(LoginConfig login) {
        this.login = login;
    }

    public EncryptionConfig getEncryption() {
        return encryption;
    }

    public void setEncryption(EncryptionConfig encryption) {
        this.encryption = encryption;
    }

    public JwtConfig getJwt() {
        return jwt;
    }

    public void setJwt(JwtConfig jwt) {
        this.jwt = jwt;
    }

    public static class LoginConfig {
        private int maxAttempts = 5;
        private long lockDuration = 1800;  // 30分钟
        private boolean enableCaptcha = true;
        private int captchaExpiration = 300;  // 5分钟

        public int getMaxAttempts() {
            return maxAttempts;
        }

        public void setMaxAttempts(int maxAttempts) {
            this.maxAttempts = maxAttempts;
        }

        public long getLockDuration() {
            return lockDuration;
        }

        public void setLockDuration(long lockDuration) {
            this.lockDuration = lockDuration;
        }

        public boolean isEnableCaptcha() {
            return enableCaptcha;
        }

        public void setEnableCaptcha(boolean enableCaptcha) {
            this.enableCaptcha = enableCaptcha;
        }

        public int getCaptchaExpiration() {
            return captchaExpiration;
        }

        public void setCaptchaExpiration(int captchaExpiration) {
            this.captchaExpiration = captchaExpiration;
        }
    }

    public static class EncryptionConfig {
        private String key;
        private String algorithm = "AES";
        private String mode = "CBC";
        private String padding = "PKCS5Padding";
        private String iv;  // 初始化向量

        public String getKey() {
            return key;
        }

        public void setKey(String key) {
            this.key = key;
        }

        public String getAlgorithm() {
            return algorithm;
        }

        public void setAlgorithm(String algorithm) {
            this.algorithm = algorithm;
        }

        public String getMode() {
            return mode;
        }

        public void setMode(String mode) {
            this.mode = mode;
        }

        public String getPadding() {
            return padding;
        }

        public void setPadding(String padding) {
            this.padding = padding;
        }

        public String getIv() {
            return iv;
        }

        public void setIv(String iv) {
            this.iv = iv;
        }
    }

    public static class JwtConfig {
        private String secret;
        private long expiration = 86400;  // 24小时
        private String issuer = "foodrecord";
        private String header = "Authorization";
        private String tokenPrefix = "Bearer ";

        public String getSecret() {
            return secret;
        }

        public void setSecret(String secret) {
            this.secret = secret;
        }

        public long getExpiration() {
            return expiration;
        }

        public void setExpiration(long expiration) {
            this.expiration = expiration;
        }

        public String getIssuer() {
            return issuer;
        }

        public void setIssuer(String issuer) {
            this.issuer = issuer;
        }

        public String getHeader() {
            return header;
        }

        public void setHeader(String header) {
            this.header = header;
        }

        public String getTokenPrefix() {
            return tokenPrefix;
        }

        public void setTokenPrefix(String tokenPrefix) {
            this.tokenPrefix = tokenPrefix;
        }
    }
} 