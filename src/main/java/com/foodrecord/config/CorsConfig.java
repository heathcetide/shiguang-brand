package com.foodrecord.config;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.Duration;

@Configuration
public class CorsConfig implements WebMvcConfigurer {
//    @Override
//    public void addCorsMappings(CorsRegistry registry) {
//        registry.addMapping("/**")
//                .allowedOriginPatterns("*")
//                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
//                .allowedHeaders("*")
//                .allowCredentials(true)
//                .maxAge(3600);
//    }
@Bean
public FilterRegistrationBean corsFilter() {
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    CorsConfiguration config = new CorsConfiguration();
//    config.setAllowCredentials(true); // 允许跨域时携带 cookie 等认证信息

    // 设置允许的具体域名
    config.addAllowedOrigin("http://localhost:3000"); // 替换为前端的实际 URL
    config.addAllowedOrigin("http://example.com"); // 如果有多个前端域名，逐个添加
    config.addAllowedOrigin("*");
    // 允许的请求头和方法
    config.addAllowedHeader("*");
    config.addAllowedMethod("*");
    config.setMaxAge(Duration.ofDays(5));
    source.registerCorsConfiguration("/**", config);
    FilterRegistrationBean bean = new FilterRegistrationBean(new CorsFilter(source));
    bean.setOrder(0); // 优先级最高
    return bean;
}
}