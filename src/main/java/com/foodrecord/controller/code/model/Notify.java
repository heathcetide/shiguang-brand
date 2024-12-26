package com.foodrecord.controller.code.model;

public class Notify {

	/**
	 * 通知平台
	 */
	private NotifyPlatform platform;

	/**
	 * 通知类型
	 */
	private String notifyType;

	/**
	 * 通知标题
	 */
	private String title;

	/**
	 * 通知内容
	 */
	private String text;

	/**
	 * 通知图片地址
	 */
	private String picUrl;

	/**
	 * 通知跳转地址
	 */
	private String link;

	public NotifyPlatform getPlatform() {
		return platform;
	}

	public void setPlatform(NotifyPlatform platform) {
		this.platform = platform;
	}

	public String getTitle() {
		return title;
	}

	public void setTitle(String title) {
		this.title = title;
	}

	public String getText() {
		return text;
	}

	public void setText(String text) {
		this.text = text;
	}

	public String getPicUrl() {
		return picUrl;
	}

	public void setPicUrl(String picUrl) {
		this.picUrl = picUrl;
	}

	public String getLink() {
		return link;
	}

	public void setLink(String link) {
		this.link = link;
	}

	public String getNotifyType() {
		return notifyType;
	}

	public void setNotifyType(String notifyType) {
		this.notifyType = notifyType;
	}
}
