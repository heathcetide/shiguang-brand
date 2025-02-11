package com.foodrecord.config;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.Duration;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Bean
    public FilterRegistrationBean corsFilter() {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        CorsConfiguration config = new CorsConfiguration();

        // 设置允许所有来源的请求
        config.addAllowedOrigin("*"); // 允许所有域名发起请求

        // 允许的请求头
        config.addAllowedHeader("*"); // 允许所有请求头

        // 允许的请求方法（包括 PUT）
        config.addAllowedMethod("*"); // 允许所有请求方法（如 GET, POST, PUT, DELETE, etc.）

        // 设置请求有效期
        config.setMaxAge(Duration.ofDays(5));

        // 注册 CORS 配置到所有路径
        source.registerCorsConfiguration("/**", config);

        // 创建 FilterRegistrationBean 并设置优先级
        FilterRegistrationBean bean = new FilterRegistrationBean(new CorsFilter(source));
        bean.setOrder(0); // 设置优先级，确保 CORS 配置最先执行
        return bean;
    }
}
