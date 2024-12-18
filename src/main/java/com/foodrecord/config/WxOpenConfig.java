package com.foodrecord.config;

import me.chanjar.weixin.mp.api.WxMpService;
import me.chanjar.weixin.mp.api.impl.WxMpServiceImpl;
import me.chanjar.weixin.mp.config.impl.WxMpDefaultConfigImpl;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 微信开放平台配置
 *
 */
@Configuration
@ConfigurationProperties(prefix = "wx.open")
public class WxOpenConfig {

    private String appId;

    private String appSecret;

    private WxMpService wxMpService;

    /**
     * 单例模式（不用 @Bean 是为了防止和公众号的 service 冲突）
     *
     * @return
     */
    public WxMpService getWxMpService() {
        if (wxMpService != null) {
            return wxMpService;
        }
        synchronized (this) {
            if (wxMpService != null) {
                return wxMpService;
            }
            WxMpDefaultConfigImpl config = new WxMpDefaultConfigImpl();
            config.setAppId(appId);
            config.setSecret(appSecret);
            WxMpService service = new WxMpServiceImpl();
            service.setWxMpConfigStorage(config);
            wxMpService = service;
            return wxMpService;
        }
    }

    public String getAppId() {
        return appId;
    }

    public void setAppId(String appId) {
        this.appId = appId;
    }

    public String getAppSecret() {
        return appSecret;
    }

    public void setAppSecret(String appSecret) {
        this.appSecret = appSecret;
    }

    public void setWxMpService(WxMpService wxMpService) {
        this.wxMpService = wxMpService;
    }
}