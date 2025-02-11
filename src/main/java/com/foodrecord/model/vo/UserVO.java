package com.foodrecord.model.vo;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.foodrecord.model.entity.User;
import io.swagger.annotations.ApiModelProperty;

import java.time.LocalDate;
import java.time.LocalDateTime;

public class UserVO {

    @ApiModelProperty(value = "用户名", example = "john_doe")
    private String username;

    @ApiModelProperty(value = "邮箱地址", example = "john.doe@example.com")
    private String email;

    @ApiModelProperty(value = "手机号", example = "13800138000")
    private String phone;

    @ApiModelProperty(value = "昵称", example = "李四")
    private String nickname;

    @ApiModelProperty(value = "头像", example = "李四")
    private String avatarUrl;

    @ApiModelProperty(value = "性别", example = "0, 1")
    private Integer gender;

    @ApiModelProperty(value = "生日", example = "2024-12-17")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "Asia/Shanghai")
    private LocalDate birthday;

    @ApiModelProperty(value = "最后登录时间", example = "2024-12-15T18:00:00")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "Asia/Shanghai")
    private LocalDateTime lastLoginTime;

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
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

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String nickname) {
        this.nickname = nickname;
    }

    public String getAvatarUrl() {
        return avatarUrl;
    }

    public void setAvatarUrl(String avatarUrl) {
        this.avatarUrl = avatarUrl;
    }

    public Integer getGender() {
        return gender;
    }

    public void setGender(Integer gender) {
        this.gender = gender;
    }

    public LocalDate getBirthday() {
        return birthday;
    }

    public void setBirthday(LocalDate birthday) {
        this.birthday = birthday;
    }

    public LocalDateTime getLastLoginTime() {
        return lastLoginTime;
    }

    public void setLastLoginTime(LocalDateTime lastLoginTime) {
        this.lastLoginTime = lastLoginTime;
    }

    public UserVO toUserVO(User user){
        UserVO userVO = new UserVO();
        userVO.setUsername(user.getUsername());
        userVO.setEmail(user.getEmail());
        userVO.setPhone(user.getPhone());
        userVO.setNickname(user.getNickname());
        userVO.setAvatarUrl(user.getAvatarUrl());
        userVO.setGender(user.getGender());
        userVO.setBirthday(user.getBirthday());
        userVO.setLastLoginTime(user.getLastLoginTime());
        return userVO;
    }
}
