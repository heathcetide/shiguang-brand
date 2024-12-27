//package com.foodrecord.messaging;
//import java.util.Optional;
//
//import com.fasterxml.jackson.core.JsonProcessingException;
//import com.fasterxml.jackson.databind.ObjectMapper;
//import com.foodrecord.model.entity.Notify;
//import com.foodrecord.model.enums.NotifyPlatform;
//import com.foodrecord.notification.NotifyHelper;
//import org.apache.kafka.clients.consumer.ConsumerRecord;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.kafka.annotation.KafkaListener;
//import org.springframework.stereotype.Component;
//
//@Component
//public class NotifyConsumer {
//
//	@Autowired
//	DingDingHelper dingDingHelper;
//
//	@Autowired
//	EnterpriseWechatHelper enterpriseWechatHelper;
//
//    private ObjectMapper objectMapper = new ObjectMapper();
//
//	@KafkaListener(topics = {"notify"})
//	public void listen(ConsumerRecord<?, ?> record) throws JsonProcessingException {
//		Optional<?> kafkaMessage = Optional.ofNullable(record.value());
//		if (kafkaMessage.isPresent()) {
//			String message = (String) kafkaMessage.get();
//            Notify notify = objectMapper.readValue(message, Notify.class);
//			NotifyHelper helper = dingDingHelper;
//			if (notify.getPlatform() == NotifyPlatform.ENTERPRISE_WECHAT) {
//				helper = enterpriseWechatHelper;
//			}
//			helper.sendNotify(notify);
//		}
//	}
//}
