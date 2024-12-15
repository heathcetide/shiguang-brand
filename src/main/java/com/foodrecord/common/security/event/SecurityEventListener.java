package com.foodrecord.common.security.event;

import com.foodrecord.service.impl.SensitiveOperationLogServiceImpl;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

/**
 * 安全事件监听器
 * 异步处理所有安全相关事件
 * 
 * @author yourname
 * @since 1.0.0
 */
@Component
public class SecurityEventListener {
    private final SensitiveOperationLogServiceImpl logService;

    public SecurityEventListener(SensitiveOperationLogServiceImpl logService) {
        this.logService = logService;
    }

    @Async
    @EventListener
    public void handleSecurityEvent(SecurityEvent event) {
//        log.info("收到安全事件: type={}, userId={}, detail={}, ip={}",
//            event.getEventType(), event.getUserId(), event.getDetail(), event.getIpAddress());
//
        // 记录到审计日志
        logService.logOperation(
            event.getUserId(),
            event.getEventType(),
            event.getDetail(),
            null,  // 这里需要考虑如何传递HttpServletRequest
            "SUCCESS",
            null
        );
    }
    
    @Async
    @EventListener
    public void handleLoginEvent(LoginEvent event) {
        if (!event.isSuccess()) {
//            log.warn("登录失败: userId={}, reason={}, ip={}",
//                event.getUserId(), event.getFailureReason(), event.getIpAddress());
        }
    }
    
    @Async
    @EventListener
    public void handlePermissionChangeEvent(PermissionChangeEvent event) {
//        log.info("权限变更: operator={}, operation={}, permission={}, targetUser={}, ip={}",
//            event.getUserId(), event.getOperation(), event.getPermission(),
//            event.getTargetUserId(), event.getIpAddress());
    }
    
    @Async
    @EventListener
    public void handlePasswordChangeEvent(PasswordChangeEvent event) {
//        log.info("密码变更: userId={}, type={}, success={}, ip={}",
//            event.getUserId(), event.getChangeType(), event.isSuccess(), event.getIpAddress());
    }
    
    @Async
    @EventListener
    public void handleAccountStatusEvent(AccountStatusEvent event) {
//        log.info("账户状态变更: userId={}, oldStatus={}, newStatus={}, reason={}, ip={}",
//            event.getUserId(), event.getOldStatus(), event.getNewStatus(),
//            event.getReason(), event.getIpAddress());
    }
    
    @Async
    @EventListener
    public void handleSensitiveOperationEvent(SensitiveOperationEvent event) {
//        log.info("敏感操作: userId={}, type={}, target={}, result={}, ip={}",
//            event.getUserId(), event.getOperationType(), event.getTargetResource(),
//            event.getResult(), event.getIpAddress());
    }
} 