package com.foodrecord.common.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * 敏感数据加密工具类
 * 使用AES算法对敏感数据进行加密和解密
 */
@Component
public class EncryptionUtils {
    
    @Value("${security.encryption.key}")
    private String encryptionKey;  // 16位密钥
    
    private static final String ALGORITHM = "AES";
    
    /**
     * 加密字符串
     * @param data 待加密的字符串
     * @return 加密后的Base64字符串
     */
    public String encrypt(String data) {
        try {
            SecretKeySpec keySpec = new SecretKeySpec(
                encryptionKey.getBytes(StandardCharsets.UTF_8), 
                ALGORITHM
            );
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, keySpec);
            
            byte[] encrypted = cipher.doFinal(data.getBytes());
            return Base64.getEncoder().encodeToString(encrypted);
        } catch (Exception e) {
            throw new RuntimeException("加密失败", e);
        }
    }
    
    /**
     * 解密字符串
     * @param encryptedData 加密后的Base64字符串
     * @return 解密后的原始字符串
     */
    public String decrypt(String encryptedData) {
        try {
            SecretKeySpec keySpec = new SecretKeySpec(
                encryptionKey.getBytes(StandardCharsets.UTF_8), 
                ALGORITHM
            );
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, keySpec);
            
            byte[] decoded = Base64.getDecoder().decode(encryptedData);
            byte[] decrypted = cipher.doFinal(decoded);
            return new String(decrypted, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("解密失败", e);
        }
    }
} 