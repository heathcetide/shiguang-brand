package com.foodrecord.core.flow.alert;

import com.foodrecord.core.db.health.DataSourceAlert;
import org.springframework.stereotype.Service;

@Service
public interface AlertManager {
    void sendAlert(DataSourceAlert alert);
    void clearAlert(String alertId);
    void updateAlert(DataSourceAlert alert);
    void acknowledgeAlert(String alertId);
    boolean isAlertActive(String alertId);
} 