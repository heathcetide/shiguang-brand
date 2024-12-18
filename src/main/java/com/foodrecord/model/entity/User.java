package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
<<<<<<< HEAD
<<<<<<< HEAD
import com.fasterxml.jackson.annotation.JsonFormat;

=======
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
import java.time.LocalDateTime;
=======
import com.fasterxml.jackson.annotation.JsonFormat;
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2

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
<<<<<<< HEAD
<<<<<<< HEAD

    @TableField(value = "nickname")
    private String nickname;

    @TableField(value = "avatar_url")
    private String avatarUrl;

    @TableField(value = "gender")
    private Integer gender;

    @TableField(value = "birthday")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "Asia/Shanghai")
    private LocalDateTime birthday;

=======
    
    @TableField(value = "avatar_url")
    private String avatarUrl;
    
    @TableField(value = "nickname")
    private String nickname;
    
    @TableField(value = "last_login_at")
    private LocalDateTime lastLoginAt;
    
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======

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
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
    @TableField(value = "status")
    private Integer status;

    @ApiModelProperty(value = "角色（USER/ADMIN/SUPER_ADMIN）", example = "USER")
    @TableField(value = "role")
    private String role;

<<<<<<< HEAD
<<<<<<< HEAD
    @TableField(value = "last_login_time")
    private LocalDateTime lastLoginTime;
=======
    @TableField(value = "permissions")
    private String permissions;
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
    @ApiModelProperty(value = "最后登录时间", example = "2024-12-15T18:00:00")
    @TableField(value = "last_login_time")
    private LocalDateTime lastLoginTime;
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2

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

<<<<<<< HEAD
<<<<<<< HEAD
=======
    public LocalDateTime getLastLoginAt() {
        return lastLoginAt;
    }

    public void setLastLoginAt(LocalDateTime lastLoginAt) {
        this.lastLoginAt = lastLoginAt;
    }

>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
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

<<<<<<< HEAD
<<<<<<< HEAD
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
=======
    public String getPermissions() {
        return permissions;
    }

    public void setPermissions(String permissions) {
        this.permissions = permissions;
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
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
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
    }
}