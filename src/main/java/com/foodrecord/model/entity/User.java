package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.fasterxml.jackson.annotation.JsonFormat;

import java.time.LocalDateTime;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "用户信息实体")
@TableName("users")
public class User extends BaseEntity {

    @ApiModelProperty(value = "用户ID", example = "10001")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户名", example = "john_doe")
    @TableField(value = "username")
    private String username;

    @ApiModelProperty(value = "密码（加密）", example = "encrypted_password")
    @TableField(value = "password")
    private String password;

    @ApiModelProperty(value = "邮箱地址", example = "john.doe@example.com")
    @TableField(value = "email")
    private String email;

    @ApiModelProperty(value = "手机号", example = "13800138000")
    @TableField(value = "phone")
    private String phone;

    @ApiModelProperty(value = "用户昵称", example = "John")
    @TableField(value = "nickname")
    private String nickname;

    @ApiModelProperty(value = "头像URL", example = "http://example.com/avatar.jpg")
    @TableField(value = "avatar_url")
    private String avatarUrl;

    @ApiModelProperty(value = "性别（1: 男, 2: 女）", example = "1")
    @TableField(value = "gender")
    private Integer gender;

    @ApiModelProperty(value = "生日", example = "1990-01-01 00:00:00")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "Asia/Shanghai")
    @TableField(value = "birthday")
    private LocalDateTime birthday;

    @ApiModelProperty(value = "状态（1: 正常, 2: 禁用, 3: 锁定, 4: 过期）", example = "1")
    @TableField(value = "status")
    private Integer status;

    @ApiModelProperty(value = "角色（USER/ADMIN/SUPER_ADMIN）", example = "USER")
    @TableField(value = "role")
    private String role;

    @ApiModelProperty(value = "最后登录时间", example = "2024-12-15T18:00:00")
    @TableField(value = "last_login_time")
    private LocalDateTime lastLoginTime;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getAvatarUrl() {
        return avatarUrl;
    }

    public void setAvatarUrl(String avatarUrl) {
        this.avatarUrl = avatarUrl;
    }

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String nickname) {
        this.nickname = nickname;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }

    public Integer getGender() {
        return gender;
    }

    public void setGender(Integer gender) {
        this.gender = gender;
    }

    public LocalDateTime getBirthday() {
        return birthday;
    }

    public void setBirthday(LocalDateTime birthday) {
        this.birthday = birthday;
    }

    public LocalDateTime getLastLoginTime() {
        return lastLoginTime;
    }

    public void setLastLoginTime(LocalDateTime lastLoginTime) {
        this.lastLoginTime = lastLoginTime;
    }
}