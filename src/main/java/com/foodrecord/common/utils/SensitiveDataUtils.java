package com.foodrecord.common.utils;

public class SensitiveDataUtils {

    /**
     * 脱敏邮箱地址
     * 示例：j****@example.com
     *
     * @param email 邮箱地址
     * @return 脱敏后的邮箱
     */
    public static String maskEmail(String email) {
        if (email == null || !email.contains("@")) {
            return "****";
        }
        String[] parts = email.split("@");
        String localPart = parts[0];
        if (localPart.length() <= 1) {
            return "****@" + parts[1];
        }
        return localPart.charAt(0) + "****@" + parts[1];
    }

    /**
     * 脱敏手机号
     * 示例：138****1234
     *
     * @param phone 手机号
     * @return 脱敏后的手机号
     */
    public static String maskPhone(String phone) {
        if (phone == null || phone.length() < 7) {
            return "****";
        }
        return phone.substring(0, 3) + "****" + phone.substring(phone.length() - 4);
    }

    /**
     * 脱敏身份证号
     * 示例：110**********1234
     *
     * @param idCard 身份证号
     * @return 脱敏后的身份证号
     */
    public static String maskIdCard(String idCard) {
        if (idCard == null || idCard.length() < 8) {
            return "****";
        }
        return idCard.substring(0, 3) + "********" + idCard.substring(idCard.length() - 4);
    }

    /**
     * 脱敏银行卡号
     * 示例：6222***********1234
     *
     * @param bankCard 银行卡号
     * @return 脱敏后的银行卡号
     */
    public static String maskBankCard(String bankCard) {
        if (bankCard == null || bankCard.length() < 8) {
            return "****";
        }
        return bankCard.substring(0, 4) + "************" + bankCard.substring(bankCard.length() - 4);
    }

    /**
     * 脱敏通用字段
     * 示例：首尾保留，中间用星号代替
     * 示例：张三 -> 张*，张三丰 -> 张*丰
     *
     * @param value 原始值
     * @param headLength 保留头部长度
     * @param tailLength 保留尾部长度
     * @return 脱敏后的值
     */
    public static String maskGeneric(String value, int headLength, int tailLength) {
        if (value == null || value.length() <= headLength + tailLength) {
            return "****";
        }
        String head = value.substring(0, headLength);
        String tail = value.substring(value.length() - tailLength);
        return head + "****" + tail;
    }

    /**
     * 隐藏姓名
     * 示例：张三 -> 张*，张三丰 -> 张*丰
     *
     * @param name 姓名
     * @return 脱敏后的姓名
     */
    public static String maskName(String name) {
        if (name == null || name.length() < 2) {
            return "*";
        }
        if (name.length() == 2) {
            return name.charAt(0) + "*";
        }
        return name.charAt(0) + "*" + name.charAt(name.length() - 1);
    }

    /**
     * 脱敏地址
     * 示例：北京市朝阳区某某小区 -> 北京市朝阳区****
     */
    public static String maskAddress(String address) {
        if (address == null || address.length() < 6) {
            return "****";
        }
        int lastIndex = address.indexOf("区");
        if (lastIndex == -1 || lastIndex + 1 >= address.length()) {
            return address.substring(0, 3) + "****";
        }
        return address.substring(0, lastIndex + 1) + "****";
    }

    /**
     * 脱敏护照号码
     * 示例：G12345678 -> G******78
     */
    public static String maskPassport(String passport) {
        if (passport == null || passport.length() < 4) {
            return "****";
        }
        return passport.substring(0, 1) + "******" + passport.substring(passport.length() - 2);
    }

    /**
     * 自定义字符脱敏
     * 示例：替换字符为 #
     */
    public static String maskCustom(String value, int headLength, int tailLength, char maskChar) {
        if (value == null || value.length() <= headLength + tailLength) {
            return "****";
        }
        String head = value.substring(0, headLength);
        String tail = value.substring(value.length() - tailLength);
        StringBuilder maskBuilder = new StringBuilder();
        for (int i = 0; i < value.length() - headLength - tailLength; i++) {
            maskBuilder.append(maskChar);
        }
        return head + maskBuilder + tail;
    }

    /**
     * 动态脱敏（通过脱敏类型选择）
     * 支持动态类型选择脱敏策略
     */
    public static String maskByType(String value, MaskType type) {
        switch (type) {
            case EMAIL:
                return maskEmail(value);
            case PHONE:
                return maskPhone(value);
            case ID_CARD:
                return maskIdCard(value);
            case BANK_CARD:
                return maskBankCard(value);
            case ADDRESS:
                return maskAddress(value);
            case PASSPORT:
                return maskPassport(value);
            default:
                return "****";
        }
    }

    public enum MaskType {
        EMAIL, PHONE, ID_CARD, BANK_CARD, ADDRESS, PASSPORT, CUSTOM
    }
}
