package com.foodrecord.common.security;

import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.codec.digest.HmacUtils;
import org.springframework.stereotype.Component;

import java.util.zip.CRC32;

/**
 * 数据完整性工具类
 * 提供各种完整性校验算法的实现
 * 
 * @author yourname
 * @since 1.0.0
 */
@Component
public class DataIntegrityUtils {
    
    /**
     * 计算数据的校验值
     *
     * @param data 原始数据
     * @param algorithm 校验算法
     * @param secretKey 密钥（HMAC算法使用）
     * @return 校验值
     */
    public String calculateChecksum(String data, IntegrityAlgorithm algorithm, String secretKey) {
        if (data == null) {
            return null;
        }
        
        try {
            switch (algorithm) {
                case MD5:
                    return DigestUtils.md5Hex(data);
                case SHA256:
                    return DigestUtils.sha256Hex(data);
                case HMAC_SHA256:
                    return new HmacUtils("HmacSHA256", secretKey).hmacHex(data);
                case CRC32:
                    CRC32 crc32 = new CRC32();
                    crc32.update(data.getBytes());
                    return String.valueOf(crc32.getValue());
                default:
                    return DigestUtils.md5Hex(data);
            }
        } catch (Exception e) {
            System.out.println("计算校验值失败: {}"+ e.getMessage());
            return null;
        }
    }
    
    /**
     * 验证数据完整性
     *
     * @param data 原始数据
     * @param checksum 校验值
     * @param algorithm 校验算法
     * @param secretKey 密钥（HMAC算法使用）
     * @return 是否通过校验
     */
    public boolean verifyIntegrity(String data, String checksum, IntegrityAlgorithm algorithm, String secretKey) {
        if (data == null || checksum == null) {
            return false;
        }
        
        String calculatedChecksum = calculateChecksum(data, algorithm, secretKey);
        return checksum.equals(calculatedChecksum);
    }
    
    /**
     * 生成带时间戳的校验值
     */
    public String calculateChecksumWithTimestamp(String data, IntegrityAlgorithm algorithm, String secretKey) {
        String timestamp = String.valueOf(System.currentTimeMillis());
        String dataWithTimestamp = data + timestamp;
        String checksum = calculateChecksum(dataWithTimestamp, algorithm, secretKey);
        return timestamp + ":" + checksum;
    }
    
    /**
     * 验证带时间戳的数据完整性
     */
    public boolean verifyIntegrityWithTimestamp(String data, String timestampedChecksum, 
            IntegrityAlgorithm algorithm, String secretKey, long maxAgeMillis) {
        try {
            String[] parts = timestampedChecksum.split(":");
            if (parts.length != 2) {
                return false;
            }
            
            long timestamp = Long.parseLong(parts[0]);
            String checksum = parts[1];
            
            // 检查时间戳是否过期
            if (System.currentTimeMillis() - timestamp > maxAgeMillis) {
                return false;
            }
            
            String dataWithTimestamp = data + parts[0];
            return verifyIntegrity(dataWithTimestamp, checksum, algorithm, secretKey);
        } catch (Exception e) {
            System.out.println("验证带时间戳的数据完整性失败: {}"+ e.getMessage());
            return false;
        }
    }
} 