package com.foodrecord.config;

import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.stereotype.Service;

import java.util.Locale;

@Service
public class LanguageService {

    private final MessageSource messageSource;

    public LanguageService(MessageSource messageSource) {
        this.messageSource = messageSource;
    }

    public String getMessage(String code, Object... args) {
        Locale locale = LocaleContextHolder.getLocale(); // 动态获取当前语言环境
        return messageSource.getMessage(code, args, locale);
    }
}
/**
 * 步骤 3：前端传递语言参数
 * 通过请求头传递语言
 *
 * 前端通过 Accept-Language 请求头传递语言参数。
 * 示例请求头：
 * makefile
 * Accept-Language: zh-CN
 * Spring 自动解析语言 Spring 默认会根据 Accept-Language 请求头来解析 Locale，无需额外配置。
 */