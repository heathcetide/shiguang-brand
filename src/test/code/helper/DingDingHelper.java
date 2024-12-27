//package com.foodrecord.controller.code.helper;
//
//import com.dewu.notify.model.Notify;
//import com.dingtalk.api.DefaultDingTalkClient;
//import com.dingtalk.api.DingTalkClient;
//import com.dingtalk.api.request.OapiRobotSendRequest;
//import com.taobao.api.ApiException;
//import org.springframework.beans.factory.annotation.Value;
//import org.springframework.stereotype.Component;
//
//
//@Component
//public class DingDingHelper implements NotifyHelper {
//
//	@Value("${dewu.notify.dingding}")
//	private String dingdingUrl;
//
//	/**
//	 * 发送钉钉消息
//	 *
//	 * @param notify 通知
//	 * @return 发送是否成功
//	 */
//	@Override
//	public boolean sendNotify(Notify notify) {
//		switch (notify.getNotifyType()) {
//			case "text":
//				return sendText(notify);
//			case "link":
//				return sendLink(notify);
//			case "markdown":
//				return sendMarkdown(notify);
//		}
//		return true;
//	}
//
//	/**
//	 * 发送文字通知
//	 *
//	 * @param notify 通知
//	 * @return 发送是否成功
//	 */
//	public boolean sendText(Notify notify) {
//		DingTalkClient client = new DefaultDingTalkClient(this.dingdingUrl);
//		OapiRobotSendRequest request = new OapiRobotSendRequest();
//		request.setMsgtype("text");
//
//		OapiRobotSendRequest.Text text = new OapiRobotSendRequest.Text();
//		text.setContent("");
//		request.setText(notify.getText());
//
//		OapiRobotSendRequest.At at = new OapiRobotSendRequest.At();
//		at.setIsAtAll(true);
//		request.setAt(at);
//		try {
//			// #5. 发送消息请求
//			client.execute(request);
//		} catch (ApiException e) {
//			e.printStackTrace();
//			return false;
//		}
//		return true;
//	}
//
//	/**
//	 * 发送链接通知
//	 *
//	 * @param notify 通知
//	 * @return 发送是否成功
//	 */
//	public boolean sendLink(Notify notify) {
//		DingTalkClient client = new DefaultDingTalkClient(this.dingdingUrl);
//		OapiRobotSendRequest request = new OapiRobotSendRequest();
//		request.setMsgtype("link");
//		OapiRobotSendRequest.Link link = new OapiRobotSendRequest.Link();
//		link.setMessageUrl(notify.getLink());
//		link.setPicUrl(notify.getPicUrl());
//		link.setTitle(notify.getTitle());
//		link.setText(notify.getText());
//		request.setLink(link);
//		try {
//			client.execute(request);
//		} catch (ApiException e) {
//			e.printStackTrace();
//			return false;
//		}
//		return true;
//	}
//
//	/**
//	 * 发送Markdown通知
//	 *
//	 * @param notify 通知
//	 * @return 发送是否成功
//	 */
//	public boolean sendMarkdown(Notify notify) {
//		DingTalkClient client = new DefaultDingTalkClient(this.dingdingUrl);
//		OapiRobotSendRequest request = new OapiRobotSendRequest();
//		request.setMsgtype("markdown");
//		OapiRobotSendRequest.Markdown markdown = new OapiRobotSendRequest.Markdown();
//		markdown.setTitle(notify.getTitle());
//		markdown.setText(notify.getText());
//		request.setMarkdown(markdown);
//		try {
//			client.execute(request);
//		} catch (ApiException e) {
//			e.printStackTrace();
//			return false;
//		}
//		return true;
//	}
//}
