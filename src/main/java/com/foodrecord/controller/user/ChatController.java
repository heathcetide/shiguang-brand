//package com.foodrecord.controller.user;
//
//import com.foodrecord.model.entity.chat.Message;
//import com.foodrecord.repository.MessageRepository;
//import com.foodrecord.service.impl.MessageService;
//import org.springframework.http.ResponseEntity;
//import org.springframework.web.bind.annotation.*;
//import org.springframework.web.multipart.MultipartFile;
//
//import javax.annotation.Resource;
//import java.util.List;
//
//@RestController
//@RequestMapping("/api/messages")
//public class ChatController {
//
//    private final MessageRepository messageRepository;
//
//    @Resource
//    private MessageService messageService;
//
//    public ChatController(MessageRepository messageRepository) {
//        this.messageRepository = messageRepository;
//    }
//
//    // 根据会话 ID 获取历史消息
//    @GetMapping("/{conversationId}")
//    public List<Message> getMessagesByConversation(@PathVariable String conversationId) {
//        return messageRepository.findByConversationId(conversationId);
//    }
//
//    @PutMapping("/mark-as-read/{messageId}")
//    public ResponseEntity<Void> markAsRead(@PathVariable String messageId) {
//        messageService.markMessageAsRead(messageId);
//        return ResponseEntity.ok().build();
//    }
//
//
//    @PutMapping("/recall/{messageId}")
//    public ResponseEntity<Void> recallMessage(@PathVariable String messageId) {
//        messageService.recallMessage(messageId);
//        return ResponseEntity.ok().build();
//    }
//
//    @PostMapping("/upload")
//    public ResponseEntity<String> uploadFile(@RequestParam("file") MultipartFile file) {
////        String fileUrl = fileStorageService.store(file);
//        return ResponseEntity.ok("fileUrl");
//    }
//
//}
