//package com.foodrecord.controller.code.api;
//
//import com.dingtalk.api.DefaultDingTalkClient;
//import com.dingtalk.api.DingTalkClient;
//import com.dingtalk.api.request.OapiRobotSendRequest;
//import com.taobao.api.ApiException;
//import org.springframework.beans.factory.annotation.Value;
//import org.springframework.stereotype.Controller;
//import org.springframework.web.bind.annotation.RequestMapping;
//import org.springframework.web.bind.annotation.ResponseBody;
//
//@Controller
//@RequestMapping("dingding")
//public class DingDingTest {
//
//	@Value("${dewu.notify.dingding}")
//	private String dingdingUrl;
//
//	@RequestMapping("/text")
//	@ResponseBody
//	public String sendText() {
//		// #0. 配置钉钉客户端，dingdingUrl即根据刚才拷贝的Webhook
//		DingTalkClient client = new DefaultDingTalkClient(this.dingdingUrl);
//		// #1. request表示整个消息请求
//		OapiRobotSendRequest request = new OapiRobotSendRequest();
//		// #2. 请求设置消息类别
//		request.setMsgtype("text");
//
//		// #3. 设置消息内容
//		OapiRobotSendRequest.Text text = new OapiRobotSendRequest.Text();
//		text.setContent("");
//		request.setText(text);
//
//		// #4. 设置钉钉@功能
//		OapiRobotSendRequest.At at = new OapiRobotSendRequest.At();
//		at.setIsAtAll(true);
//		request.setAt(at);
//		try {
//			// #5. 发送消息请求
//			client.execute(request);
//		} catch (ApiException e) {
//			e.printStackTrace();
//		}
//		return "success";
//	}
//
//	@RequestMapping("/link")
//	@ResponseBody
//	public String sendLink(){
//		DingTalkClient client = new DefaultDingTalkClient(this.dingdingUrl);
//		OapiRobotSendRequest request = new OapiRobotSendRequest();
//		request.setMsgtype("link");
//		OapiRobotSendRequest.Link link = new OapiRobotSendRequest.Link();
//		link.setMessageUrl("https://www.dewu.com/about");
//		link.setPicUrl("https://china-product.poizon.com/FuykjexQ6q_23EBTg7aMVefZMBX1new.png");
//		link.setTitle("得物来新订单了");
//		link.setText("得物App是全球领先的集正品潮流装备、潮流商品鉴别、潮流生活社区于一体的新一代潮流网购社区");
//		request.setLink(link);
//		try {
//			client.execute(request);
//		} catch (ApiException e) {
//			e.printStackTrace();
//		}
//		return "success";
//	}
//
//	@RequestMapping("/markdown")
//	@ResponseBody
//	public String sendMarkdown(){
//		DingTalkClient client = new DefaultDingTalkClient(this.dingdingUrl);
//		OapiRobotSendRequest request = new OapiRobotSendRequest();
//		request.setMsgtype("markdown");
//		OapiRobotSendRequest.Markdown markdown = new OapiRobotSendRequest.Markdown();
//		markdown.setTitle("得物来新订单了");
//		markdown.setText("#### 得物来新订单了\n" +
//				"> 樊梵 购买了 Nike Tanjun 男子 休闲跑鞋" +
//				"> ![screenshot](https://china-product.poizon.com/FuykjexQ6q_23EBTg7aMVefZMBX1new.png)\n"  +
//				"> 支付中");
//		request.setMarkdown(markdown);
//		try {
//			client.execute(request);
//		} catch (ApiException e) {
//			e.printStackTrace();
//		}
//		return "success";
//	}
//}
