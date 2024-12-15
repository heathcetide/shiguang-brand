package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
<<<<<<< HEAD
import com.fasterxml.jackson.annotation.JsonFormat;

=======
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
import java.time.LocalDateTime;

@TableName("users")
public class User extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField(value = "username")
    private String username;
    
    @TableField(value = "password")
    private String password;
    
    @TableField(value = "email")
    private String email;
    
    @TableField(value = "phone")
    private String phone;
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
    @TableField(value = "status")
    private Integer status;

    @TableField(value = "role")
    private String role;

<<<<<<< HEAD
    @TableField(value = "last_login_time")
    private LocalDateTime lastLoginTime;
=======
    @TableField(value = "permissions")
    private String permissions;
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82

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
=======
    public LocalDateTime getLastLoginAt() {
        return lastLoginAt;
    }

    public void setLastLoginAt(LocalDateTime lastLoginAt) {
        this.lastLoginAt = lastLoginAt;
    }

>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
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
    }
}