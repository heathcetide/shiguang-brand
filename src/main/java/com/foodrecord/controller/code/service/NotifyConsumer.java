//package com.foodrecord.controller.code.service;
//
//import com.alibaba.fastjson.JSON;
//import com.alibaba.fastjson.JSONObject;
//import com.dewu.notify.helper.DingDingHelper;
//import com.dewu.notify.helper.EnterpriseWechatHelper;
//import com.dewu.notify.helper.NotifyHelper;
//import com.dewu.notify.model.Notify;
//import com.dewu.notify.model.NotifyPlatform;
//import java.util.Optional;
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
//	@KafkaListener(topics = {"notify"})
//	public void listen(ConsumerRecord<?, ?> record) {
//		Optional<?> kafkaMessage = Optional.ofNullable(record.value());
//		if (kafkaMessage.isPresent()) {
//			String message = (String) kafkaMessage.get();
//			Notify notify = JSON.parseObject(message, Notify.class);
//			NotifyHelper helper = dingDingHelper;
//			if (notify.getPlatform() == NotifyPlatform.ENTERPRISE_WECHAT) {
//				helper = enterpriseWechatHelper;
//			}
//			helper.sendNotify(notify);
//		}
//	}
//}
