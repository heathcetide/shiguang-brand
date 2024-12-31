package com.foodrecord.core.db.health;

import com.foodrecord.core.flow.monitor.HealthIssue;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import javax.sql.DataSource;
import java.time.LocalDateTime;
import java.util.List;

public interface HealthCheckExecutor {
    HealthCheckResult execute(DataSource dataSource);
}

class HealthCheckResult {
    private final boolean success;
    private final List<HealthIssue> issues;
    private final LocalDateTime checkTime;
    private final long responseTime;
    private final ConnectionStats connectionStats;

    public HealthCheckResult(boolean success, List<HealthIssue> issues, LocalDateTime checkTime, 
                           long responseTime, ConnectionStats connectionStats) {
        this.success = success;
        this.issues = issues;
        this.checkTime = checkTime;
        this.responseTime = responseTime;
        this.connectionStats = connectionStats;
    }

    public boolean isSuccess() {
        return success;
    }

    public List<HealthIssue> getIssues() {
        return issues;
    }

    public LocalDateTime getCheckTime() {
        return checkTime;
    }

    public long getResponseTime() {
        return responseTime;
    }

    public ConnectionStats getConnectionStats() {
        return connectionStats;
    }

    public static class ConnectionStats {
        private final int activeConnections;
        private final int idleConnections;
        private final int maxConnections;
        private final long waitingThreads;

        public ConnectionStats(int activeConnections, int idleConnections, 
                             int maxConnections, long waitingThreads) {
            this.activeConnections = activeConnections;
            this.idleConnections = idleConnections;
            this.maxConnections = maxConnections;
            this.waitingThreads = waitingThreads;
        }

        public int getActiveConnections() {
            return activeConnections;
        }

        public int getIdleConnections() {
            return idleConnections;
        }

        public int getMaxConnections() {
            return maxConnections;
        }

        public long getWaitingThreads() {
            return waitingThreads;
        }
    }
} 