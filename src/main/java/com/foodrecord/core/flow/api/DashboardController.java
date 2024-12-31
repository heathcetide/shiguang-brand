package com.foodrecord.core.flow.api;

import com.foodrecord.common.monitor.PerformanceMonitor;
import com.foodrecord.core.flow.alert.Alert;
import com.foodrecord.core.flow.alert.AlertManager;
import com.foodrecord.core.flow.alert.AlertRule;
import com.foodrecord.core.flow.dashboard.DashboardOverview;
import com.foodrecord.core.flow.monitor.ActiveFlow;
import com.foodrecord.core.flow.monitor.FlowPerformanceMonitor;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/flow/dashboard")
public class DashboardController {
    private final FlowPerformanceMonitor performanceMonitor;
    private final AlertManager alertManager;

    public DashboardController(FlowPerformanceMonitor performanceMonitor, AlertManager alertManager) {
        this.performanceMonitor = performanceMonitor;
        this.alertManager = alertManager;
    }

    @GetMapping("/overview")
    public DashboardOverview getOverview() {
        DashboardOverview overview = new DashboardOverview();
//        overview.setActiveFlows(getActiveFlows());
//        overview.setRecentAlerts(getRecentAlerts());
//        overview.setPerformanceMetrics(getPerformanceMetrics());
        return overview;
    }
    
    @GetMapping("/alerts")
    public List<Alert> getAlerts(@RequestParam(required = false) AlertRule.AlertLevel level) {
//        return alertManager.getAlerts(level);
        return null;
    }
    
    @GetMapping("/performance")
    public Map<String, FlowPerformanceMonitor.PerformanceStats> getPerformance(
            @RequestParam(required = false) String flowId) {
        return performanceMonitor.getStats(flowId);
    }
    
    @PostMapping("/alerts/rules")
    public void addAlertRule(@RequestBody AlertRule rule) {
//        alertManager.addAlertRule(rule);
    }

    private List<ActiveFlow> getActiveFlows() {
        return performanceMonitor.getActiveFlows().stream()
            .map(flow -> {
                ActiveFlow activeFlow = new ActiveFlow();
                activeFlow.setFlowId(flow.getFlowId());
                activeFlow.setStatus(flow.getStatus());
                activeFlow.setStartTime(flow.getStartTime());
                activeFlow.setDuration(flow.getDuration());
                activeFlow.setCompletedNodes(flow.getCompletedNodes());
                activeFlow.setTotalNodes(flow.getTotalNodes());
                return activeFlow;
            })
            .collect(Collectors.toList());
    }

    private List<Alert> getRecentAlerts() {
//        return alertManager.getRecentAlerts();
        return null;
    }

    private Map<String, Object> getPerformanceMetrics() {
        Map<String, Object> metrics = new HashMap<>();
        metrics.put("systemMetrics", performanceMonitor.getSystemMetrics());
        metrics.put("flowMetrics", performanceMonitor.getFlowMetrics());
        return metrics;
    }
} 