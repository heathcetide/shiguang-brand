//package com.foodrecord.repository;
//
//import com.foodrecord.model.entity.chat.Message;
//import org.springframework.data.mongodb.repository.MongoRepository;
//
//import java.util.List;
//
//public interface MessageRepository extends MongoRepository<Message, String> {
//
//    List<Message> findByConversationId(String conversationId);
//
//    List<Message> findByReceiverIdAndIsReadFalse(String userId);
//}