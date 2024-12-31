package com.foodrecord.core.flow.websocket;

import com.foodrecord.controller.user.UserController;
import com.foodrecord.core.flow.event.FlowEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

@Component
public class FlowMonitorWebSocket extends TextWebSocketHandler {

    private static final Logger logger = LoggerFactory.getLogger(UserController.class);
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper = new ObjectMapper();
    
    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String flowId = getFlowIdFromSession(session);
        sessions.put(flowId, session);
    }
    
    public void sendFlowUpdate(String flowId, FlowEvent event) {
        WebSocketSession session = sessions.get(flowId);
        if (session != null && session.isOpen()) {
            try {
                String message = objectMapper.writeValueAsString(event);
                session.sendMessage(new TextMessage(message));
            } catch (Exception e) {
                logger.error("Failed to send flow update", e);
            }
        }
    }
    
    private String getFlowIdFromSession(WebSocketSession session) {
        return session.getUri().getPath().substring(
            session.getUri().getPath().lastIndexOf('/') + 1);
    }
} 