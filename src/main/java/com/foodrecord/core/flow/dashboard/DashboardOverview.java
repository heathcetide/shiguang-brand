package com.foodrecord.core.flow.dashboard;

import org.springframework.data.annotation.Id;
import org.springframework.data.elasticsearch.annotations.Document;
import org.springframework.data.elasticsearch.annotations.Field;
import org.springframework.data.elasticsearch.annotations.FieldType;
import java.time.LocalDateTime;
import java.util.Map;

public class DashboardOverview {
    @Document(indexName = "system-metrics")
    public static class SystemMetrics {
        @Id
        private String id;
        
        @Field(type = FieldType.Double)
        private double cpuUsage;
        
        @Field(type = FieldType.Double)
        private double memoryUsage;
        
        @Field(type = FieldType.Double)
        private double diskUsage;
        
        @Field(type = FieldType.Object)
        private Map<String, Double> networkTraffic;
        
        @Field(type = FieldType.Date)
        private LocalDateTime timestamp;

        public SystemMetrics() {
            this.id = java.util.UUID.randomUUID().toString();
            this.timestamp = LocalDateTime.now();
        }

        public double getCpuUsage() {
            return cpuUsage;
        }

        public void setCpuUsage(double cpuUsage) {
            this.cpuUsage = cpuUsage;
        }

        public double getMemoryUsage() {
            return memoryUsage;
        }

        public void setMemoryUsage(double memoryUsage) {
            this.memoryUsage = memoryUsage;
        }

        public double getDiskUsage() {
            return diskUsage;
        }

        public void setDiskUsage(double diskUsage) {
            this.diskUsage = diskUsage;
        }

        public Map<String, Double> getNetworkTraffic() {
            return networkTraffic;
        }

        public void setNetworkTraffic(Map<String, Double> networkTraffic) {
            this.networkTraffic = networkTraffic;
        }

        public LocalDateTime getTimestamp() {
            return timestamp;
        }

        public void setTimestamp(LocalDateTime timestamp) {
            this.timestamp = timestamp;
        }

        public boolean hasHighUsage() {
            return cpuUsage > 80 || memoryUsage > 80 || diskUsage > 80;
        }

        public String getId() {
            return id;
        }

        public void setId(String id) {
            this.id = id;
        }
    }
}