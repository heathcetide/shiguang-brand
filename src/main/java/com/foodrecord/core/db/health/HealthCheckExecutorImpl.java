package com.foodrecord.core.db.health;

import com.foodrecord.core.flow.monitor.HealthIssue;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Service
public class HealthCheckExecutorImpl implements HealthCheckExecutor {

    @Override
    public HealthCheckResult execute(DataSource dataSource) {
        List<HealthIssue> issues = new ArrayList<>();
        long startTime = System.currentTimeMillis();
        boolean success = true;
        HealthCheckResult.ConnectionStats connectionStats = null;

        try (Connection connection = dataSource.getConnection()) {
            // 模拟检查数据库连接是否可用
            if (connection.isValid(5)) {
                connectionStats = getConnectionStats(dataSource);
            } else {
                success = false;
//                issues.add(new HealthIssue("Connection is not valid", "Check database availability"));
            }
        } catch (SQLException e) {
            success = false;
//            issues.add(new HealthIssue("SQLException occurred", e.getMessage()));
        }

        long responseTime = System.currentTimeMillis() - startTime;

        // 如果响应时间超过预定义的阈值，也可以添加问题
        if (responseTime > 1000) { // 例如，1秒超时
//            issues.add(new HealthIssue("Slow response time", "Response time exceeded 1 second"));
        }

        return new HealthCheckResult(
                success,
                issues,
                LocalDateTime.now(),
                responseTime,
                connectionStats
        );
    }

    private HealthCheckResult.ConnectionStats getConnectionStats(DataSource dataSource) {
        // 数据源连接统计的模拟逻辑（实际实现需根据数据源类型而定）
        // 假设数据源为 HikariCP，可以通过 HikariDataSource 获取连接统计信息
        if (dataSource instanceof com.zaxxer.hikari.HikariDataSource) {
            com.zaxxer.hikari.HikariDataSource hikariDataSource = (com.zaxxer.hikari.HikariDataSource) dataSource;
            return new HealthCheckResult.ConnectionStats(
                    hikariDataSource.getHikariPoolMXBean().getActiveConnections(),
                    hikariDataSource.getHikariPoolMXBean().getIdleConnections(),
                    hikariDataSource.getMaximumPoolSize(),
                    hikariDataSource.getHikariPoolMXBean().getThreadsAwaitingConnection()
            );
        }
        // 如果不是 HikariCP 数据源，返回默认的连接统计信息
        return new HealthCheckResult.ConnectionStats(0, 0, 0, 0);
    }
}
