package com.foodrecord.config;

import com.foodrecord.interceptor.FoodAuthInterceptor;
import com.foodrecord.interceptor.JwtInterceptor;
import org.checkerframework.checker.units.qual.A;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurationSupport;
import org.springframework.context.annotation.Bean;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import springfox.documentation.builders.ApiInfoBuilder;
import springfox.documentation.builders.PathSelectors;
import springfox.documentation.builders.RequestHandlerSelectors;
import springfox.documentation.service.ApiInfo;
import springfox.documentation.spi.DocumentationType;
import springfox.documentation.spring.web.plugins.Docket;

import javax.annotation.Resource;


@Configuration
public class WebConfig extends WebMvcConfigurationSupport {

    @Resource
    private JwtInterceptor jwtInterceptor;

    @Autowired
    @Qualifier("foodAuthInterceptor")
    private FoodAuthInterceptor authInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(jwtInterceptor)
                .addPathPatterns("/api/users/**").addPathPatterns("/api/health-data/**")
                .excludePathPatterns("/api/users/login/**", "/api/users/register/**","/api/users/email/code","/api/foods/es/**");
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/admin/**","/api/posts/**").addPathPatterns("/api/foods/**").excludePathPatterns("/api/foods/es/**");
    }

    @Bean
    public Docket docket(){
        ApiInfo apiInfo = new ApiInfoBuilder()
                .title("食光烙记接口文档")
                .version("1.0")
                .description("描述")
                .build();

        Docket docket = new Docket(DocumentationType.OAS_30)
                .apiInfo(apiInfo)
                .select()
                .build();
        return docket;
    }

    protected void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/doc.html").addResourceLocations("classpath:/META-INF/resources/");
        registry.addResourceHandler("/webjars/**").addResourceLocations("classpath:/META-INF/resources/webjars/");
    }

    @Bean
    public Docket adminApi() {
        ApiInfo apiInfo = new ApiInfoBuilder()
                .title("食光烙记接口文档")
                .version("1.0")
                .description("描述")
                .build();
        return new Docket(DocumentationType.OAS_30)
                .apiInfo(apiInfo)
                .groupName("管理员模块")
                .select()
                .apis(RequestHandlerSelectors.basePackage("com.foodrecord.controller.admin"))
                .paths(PathSelectors.any())
                .build();
    }

    @Bean
    public Docket userApi() {
        ApiInfo apiInfo = new ApiInfoBuilder()
                .title("食光烙记接口文档")
                .version("1.0")
                .description("描述")
                .build();
        return new Docket(DocumentationType.OAS_30)
                .apiInfo(apiInfo)
                .groupName("用户模块")
                .select()
                .apis(RequestHandlerSelectors.basePackage("com.foodrecord.controller.user"))
                .paths(PathSelectors.any())
                .build();
    }

    @Bean
    public Docket guestApi() {
        ApiInfo apiInfo = new ApiInfoBuilder()
                .title("食光烙记接口文档")
                .version("1.0")
                .description("描述")
                .build();
        return new Docket(DocumentationType.OAS_30)
                .groupName("游客模块")
                .select()
                .apis(RequestHandlerSelectors.basePackage("com.foodrecord.controller.guest"))
                .paths(PathSelectors.any())
                .build();
    }
}