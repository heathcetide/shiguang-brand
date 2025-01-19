package com.foodrecord.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.common.utils.JwtUtils;
import com.foodrecord.model.entity.chat.Message;
//import com.foodrecord.repository.MessageRepository;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class ChatWebSocketHandler implements WebSocketHandler {

    private final JwtUtils jwtUtils;
//    private final MessageRepository messageRepository;
    private final ObjectMapper objectMapper;

    // 存储用户 ID 和 WebSocket 会话的映射
    private static final Map<String, WebSocketSession> userSessions = new ConcurrentHashMap<>();


    public ChatWebSocketHandler(JwtUtils jwtUtils, ObjectMapper objectMapper) {
        this.jwtUtils = jwtUtils;
//        this.messageRepository = messageRepository;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        try {
            // 从 URL 参数中获取 token
            String token = session.getUri().getQuery().split("=")[1];

            // 校验 JWT 并提取用户 ID
            String userId = String.valueOf(jwtUtils.getUserIdFromToken(token));

            // 将用户 ID 和会话绑定
            userSessions.put(userId, session);

            // 加载未读消息
//            List<Message> unreadMessages = messageRepository.findByReceiverIdAndIsReadFalse(userId);
//            for (Message message : unreadMessages) {
//                session.sendMessage(new TextMessage(objectMapper.writeValueAsString(message)));
//            }

            System.out.println("User connected: " + userId);
        } catch (Exception e) {
            System.err.println("Invalid WebSocket connection: " + e.getMessage());
            try {
                session.close(CloseStatus.BAD_DATA);
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void handleMessage(WebSocketSession session, WebSocketMessage<?> message) {
        try {
            // 解析收到的消息
            Message incomingMessage = objectMapper.readValue(message.getPayload().toString(), Message.class);

            // 从当前会话获取发送者的 userId
            String senderId = null;
            for (Map.Entry<String, WebSocketSession> entry : userSessions.entrySet()) {
                if (entry.getValue().equals(session)) {
                    senderId = entry.getKey();
                    break;
                }
            }

            if (senderId == null) {
                throw new IllegalStateException("Sender is not authenticated");
            }

            incomingMessage.setSenderId(senderId);

            // 将消息保存到数据库
//            messageRepository.save(incomingMessage);

            // 推送消息给接收者
            WebSocketSession receiverSession = userSessions.get(incomingMessage.getReceiverId());
            if (receiverSession != null && receiverSession.isOpen()) {
                receiverSession.sendMessage(new TextMessage(objectMapper.writeValueAsString(incomingMessage)));
            } else {
                System.out.println("Receiver is offline, message saved to database.");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }


    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        System.err.println("WebSocket error: " + exception.getMessage());
        try {
            session.close(CloseStatus.SERVER_ERROR);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        // 从映射中移除用户会话
        userSessions.values().remove(session);
        System.out.println("WebSocket connection closed: " + session.getId());
    }

    @Override
    public boolean supportsPartialMessages() {
        return false;
    }

    public void sendReadReceipt(String senderId, String messageId) {
        WebSocketSession senderSession = userSessions.get(senderId); // 获取发送者的 WebSocket 会话
        if (senderSession != null && senderSession.isOpen()) {
            try {
                senderSession.sendMessage(new TextMessage(
                        new ObjectMapper().writeValueAsString(Map.of(
                                "type", "read-receipt",
                                "messageId", messageId
                        ))
                ));
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }
}