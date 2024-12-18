package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.io.Serializable;

/**
 * 第三方账号绑定实体
 */
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "第三方账号绑定实体")
@TableName("third_party_account")
public class ThirdPartyAccount implements Serializable {

    @ApiModelProperty(value = "主键ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001")
    private Long userId;

    @ApiModelProperty(value = "第三方平台名称（如 WeChat, GitHub, Google）", example = "WeChat")
    private String platform;

    @ApiModelProperty(value = "第三方平台账号ID", example = "wx123456")
    private String accountId;

    @ApiModelProperty(value = "第三方平台显示名称", example = "John Doe")
    private String accountName;

    @ApiModelProperty(value = "绑定时间", example = "2024-12-16 12:00:00")
    private String bindTime;


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
