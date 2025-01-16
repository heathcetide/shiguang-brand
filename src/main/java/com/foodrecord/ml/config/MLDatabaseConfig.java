// TODO ml - module
//package com.foodrecord.ml.config;
//
//import org.mybatis.spring.SqlSessionTemplate;
//import org.springframework.beans.factory.annotation.Qualifier;
//import org.springframework.boot.context.properties.ConfigurationProperties;
//import org.springframework.boot.jdbc.DataSourceBuilder;
//import org.springframework.context.annotation.Configuration;
//import org.springframework.context.annotation.Bean;
//import javax.sql.DataSource;
//import org.apache.ibatis.session.SqlSessionFactory;
//import org.mybatis.spring.SqlSessionFactoryBean;
//import org.mybatis.spring.annotation.MapperScan;
//import org.springframework.context.annotation.Primary;
//import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
//
////@Configuration
////@MapperScan(basePackages = "com.foodrecord.mapper", sqlSessionFactoryRef = "mlSqlSessionFactory")
//public class MLDatabaseConfig {
//
//    @Primary
//    @Bean(name = "mlDataSource")
//    @ConfigurationProperties(prefix = "spring.datasource.ml") // 从 application.yml 中加载配置
//    public DataSource mlDataSource() {
//        return DataSourceBuilder.create().build();
//    }
//
//    @Primary
//    @Bean(name = "mlSqlSessionFactory")
//    public SqlSessionFactory mlSqlSessionFactory(@Qualifier("mlDataSource") DataSource dataSource) throws Exception {
//        SqlSessionFactoryBean factoryBean = new SqlSessionFactoryBean();
//        factoryBean.setDataSource(dataSource);
//
//        // 配置MyBatis的Mapper文件路径（如有需要）
//        factoryBean.setMapperLocations(
//                new PathMatchingResourcePatternResolver().getResources("classpath:mapper/*.xml")
//        );
//
//        // 配置MyBatis的其他属性，如别名包路径
//        factoryBean.setTypeAliasesPackage("com.foodrecord.ml.entity");
//
//        return factoryBean.getObject();
//    }
//
//    @Bean(name = "mlSqlSessionTemplate")
//    public SqlSessionTemplate mlSqlSessionTemplate(@Qualifier("mlSqlSessionFactory") SqlSessionFactory sqlSessionFactory) {
//        return new SqlSessionTemplate(sqlSessionFactory);
//    }
//}
///**
// * spring:
// *   datasource:
// *     ml:
// *       url: jdbc:mysql://localhost:3306/food_record
// *       username: root
// *       password: password
// *       driver-class-name: com.mysql.cj.jdbc.Driver
// */