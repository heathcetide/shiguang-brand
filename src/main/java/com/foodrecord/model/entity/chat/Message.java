//package com.foodrecord.model.entity.chat;
//
//import org.springframework.data.annotation.Id;
//import org.springframework.data.mongodb.core.mapping.Document;
//
//import java.time.LocalDateTime;
//
//@Document(collection = "messages")
//public class Message {
//    @Id
//    private String id;
//    private String conversationId; // 会话 ID
//    private String senderId;       // 发送者 ID
//    private String receiverId;     // 接收者 ID
//    private String content;        // 消息内容
//    private String messageType;    // 消息类型: text, image, video
//    private LocalDateTime timestamp; // 时间戳
//    private boolean isRead;        // 是否已读
//
//    public String getId() {
//        return id;
//    }
//
//    public void setId(String id) {
//        this.id = id;
//    }
//
//    public String getConversationId() {
//        return conversationId;
//    }
//
//    public void setConversationId(String conversationId) {
//        this.conversationId = conversationId;
//    }
//
//    public String getSenderId() {
//        return senderId;
//    }
//
//    public void setSenderId(String senderId) {
//        this.senderId = senderId;
//    }
//
//    public String getReceiverId() {
//        return receiverId;
//    }
//
//    public void setReceiverId(String receiverId) {
//        this.receiverId = receiverId;
//    }
//
//    public String getContent() {
//        return content;
//    }
//
//    public void setContent(String content) {
//        this.content = content;
//    }
//
//    public String getMessageType() {
//        return messageType;
//    }
//
//    public void setMessageType(String messageType) {
//        this.messageType = messageType;
//    }
//
//    public LocalDateTime getTimestamp() {
//        return timestamp;
//    }
//
//    public void setTimestamp(LocalDateTime timestamp) {
//        this.timestamp = timestamp;
//    }
//
//    public boolean isRead() {
//        return isRead;
//    }
//
//    public void setRead(boolean read) {
//        isRead = read;
//    }
//}
