package com.foodrecord.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class SignalingWebSocketHandler extends TextWebSocketHandler {
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String userId = getUserIdFromSession(session);
        if (userId != null) {
            sessions.put(userId, session);
            System.out.println("User connected: " + userId);
        } else {
            try {
                session.close(CloseStatus.BAD_DATA);
                System.out.println("Connection rejected: userId is null");
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        try {
            ObjectMapper objectMapper = new ObjectMapper();

            Map<String, Object> payload = objectMapper.readValue(message.getPayload(), Map.class);
            if (!(payload.get("targetUserId") instanceof String)) {
                System.out.println("Invalid targetUserId type");
                return;
            }

            String targetUserId = (String) payload.get("targetUserId");
            String type = String.valueOf(payload.get("type"));
            String data = String.valueOf(payload.get("data"));


            WebSocketSession targetSession = sessions.get(targetUserId);
            if (targetSession != null && targetSession.isOpen()) {
                Map<String, String> response = Map.of(
                        "type", type,
                        "data", data,
                        "fromUserId", getUserIdFromSession(session)
                );
                targetSession.sendMessage(new TextMessage(objectMapper.writeValueAsString(response)));
            } else {
                System.out.println("Target user not connected: " + targetUserId);
            }
        } catch (Exception e) {
            e.printStackTrace();
            try {
                session.close(CloseStatus.SERVER_ERROR);
            } catch (Exception ex) {
                ex.printStackTrace();
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String userId = getUserIdFromSession(session);
        if (userId != null) {
            sessions.remove(userId);
            System.out.println("User disconnected: " + userId);
        }
    }

    private String getUserIdFromSession(WebSocketSession session) {
        Object userId = session.getAttributes().get("userId");
        if (userId != null) {
            return userId.toString();
        } else {
            throw new IllegalStateException("WebSocket session does not contain userId.");
        }
    }
}
