package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.io.Serializable;

/**
 * 第三方账号绑定实体
 */
@TableName("third_party_account")
public class ThirdPartyAccount implements Serializable {

    @TableId(type = IdType.AUTO)
    private Long id; // 主键

    private Long userId; // 用户 ID

    private String platform; // 第三方平台名称（如 WeChat, GitHub, Google）

    private String accountId; // 第三方平台账号 ID

    private String accountName; // 第三方平台显示名称（如微信昵称）

    private String bindTime; // 绑定时间

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public String getPlatform() {
        return platform;
    }

    public void setPlatform(String platform) {
        this.platform = platform;
    }

    public String getAccountId() {
        return accountId;
    }

    public void setAccountId(String accountId) {
        this.accountId = accountId;
    }

    public String getAccountName() {
        return accountName;
    }

    public void setAccountName(String accountName) {
        this.accountName = accountName;
    }

    public String getBindTime() {
        return bindTime;
    }

    public void setBindTime(String bindTime) {
        this.bindTime = bindTime;
    }
}
