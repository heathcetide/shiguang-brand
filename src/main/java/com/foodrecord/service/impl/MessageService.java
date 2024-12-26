//package com.foodrecord.service.impl;
//
//import com.foodrecord.config.ChatWebSocketHandler;
//import com.foodrecord.model.entity.chat.Message;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.data.mongodb.core.MongoTemplate;
//import org.springframework.data.mongodb.core.query.Criteria;
//import org.springframework.data.mongodb.core.query.Query;
//import org.springframework.data.mongodb.core.query.Update;
//import org.springframework.stereotype.Service;
//
//@Service
//public class MessageService {
//    @Autowired
//    private MongoTemplate mongoTemplate;
//
////    public void markMessageAsRead(String messageId) {
////        Query query = new Query(Criteria.where("_id").is(messageId));
////        Update update = new Update().set("isRead", true);
////        mongoTemplate.updateFirst(query, update, Message.class);
////    }
//
//    @Autowired
//    private ChatWebSocketHandler webSocketHandler;
//
//    public void markMessageAsRead(String messageId) {
//        // 更新数据库中的消息状态
//        Query query = new Query(Criteria.where("_id").is(messageId));
//        Update update = new Update().set("isRead", true);
//        mongoTemplate.updateFirst(query, update, Message.class);
//
//        // 获取消息内容以便推送给发送者
//        Message message = mongoTemplate.findOne(query, Message.class);
//        if (message != null) {
//            // 推送已读状态给消息的发送者
//            webSocketHandler.sendReadReceipt(message.getSenderId(), messageId);
//        }
//    }
//
//    public void recallMessage(String messageId) {
//        Query query = new Query(Criteria.where("_id").is(messageId));
//        Update update = new Update().set("content", "此消息已撤回").set("isRecalled", true);
//        mongoTemplate.updateFirst(query, update, Message.class);
//    }
//
//}
