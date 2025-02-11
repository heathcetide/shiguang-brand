package com.foodrecord.common.security;

import com.foodrecord.exception.InvalidPasswordException;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

@Component
public class PasswordValidator {
    private final PasswordPolicy policy;

    public PasswordValidator(PasswordPolicy policy) {
        this.policy = policy;
    }

    public void validate(String password, List<String> oldPasswords) {
        List<String> violations = new ArrayList<>();

        // 检查长度
        if (password.length() < policy.getMinLength()) {
            violations.add("密码长度不能小于" + policy.getMinLength() + "位");
        }
        if (password.length() > policy.getMaxLength()) {
            violations.add("密码长度不能大于" + policy.getMaxLength() + "位");
        }

        // 检查大写字母
        if (policy.isRequireUppercase() && !Pattern.compile("[A-Z]").matcher(password).find()) {
            violations.add("密码必须包含大写字母");
        }

        // 检查小写字母
        if (policy.isRequireLowercase() && !Pattern.compile("[a-z]").matcher(password).find()) {
            violations.add("密码必须包含小写字母");
        }

        // 检查数字
        if (policy.isRequireDigit() && !Pattern.compile("\\d").matcher(password).find()) {
            violations.add("密码必须包含数字");
        }

        // 检查特殊字符
        if (policy.isRequireSpecial() && !Pattern.compile("[" + Pattern.quote(policy.getSpecialChars()) + "]").matcher(password).find()) {
            violations.add("密码必须包含特殊字符");
        }

        // 检查重复字符
        for (int i = 0; i <= password.length() - policy.getMaxRepeatedChars(); i++) {
            String sub = password.substring(i, i + policy.getMaxRepeatedChars());
            if (sub.chars().distinct().count() == 1) {
                violations.add("密码不能包含" + policy.getMaxRepeatedChars() + "个以上连续相同的字符");
                break;
            }
        }

        // 检查历史密码
        if (oldPasswords != null && oldPasswords.contains(password)) {
            violations.add("不能使用最近" + policy.getHistorySize() + "次使用过的密码");
        }

        if (!violations.isEmpty()) {
            throw new InvalidPasswordException(String.join("; ", violations));
        }
    }
} 