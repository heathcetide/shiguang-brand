package com.foodrecord.core.db.config;

import com.foodrecord.core.db.routing.LoadBalanceStrategy;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;
import java.util.List;
import java.util.ArrayList;

@Configuration
public class DataSourceConfig {
    
    @Value("${datasource.load-balance-strategy:ROUND_ROBIN}")
    private String loadBalanceStrategyName;

    @Bean
    public LoadBalanceStrategy loadBalanceStrategy() {
        try {
            return LoadBalanceStrategy.valueOf(loadBalanceStrategyName.toUpperCase());
        } catch (IllegalArgumentException e) {
            return LoadBalanceStrategy.ROUND_ROBIN; // 默认策略
        }
    }

    @Bean
    public List<DataSource> slaveDataSources() {
        List<DataSource> slaves = new ArrayList<>();
        // 配置从数据源列表
        return slaves; // 这里需要实际的数据源配置
    }

    @Bean
    @Primary
    public DataSource masterDataSource() {
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl("jdbc:mysql://localhost:3306/food_record?useUnicode=true&characterEncoding=utf-8&serverTimezone=Asia/Shanghai&noAccessToProcedureBodies=false");
        dataSource.setUsername("root");
        dataSource.setPassword("1234");
        dataSource.setDriverClassName("com.mysql.cj.jdbc.Driver");
        return dataSource;
    }
} 