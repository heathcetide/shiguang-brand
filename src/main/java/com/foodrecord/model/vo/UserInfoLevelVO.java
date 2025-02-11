package com.foodrecord.model.vo;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.foodrecord.model.entity.User;
import io.swagger.annotations.ApiModelProperty;

import java.time.LocalDate;
import java.time.LocalDateTime;

public class UserInfoLevelVO {

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

    @ApiModelProperty(value = "等级名称", example = "初级")
    private String levelName;

    @ApiModelProperty(value = "最低分", example = "0")
    private Integer minPoints;

    @ApiModelProperty(value = "最高分", example = "50")
    private Integer maxPoints;

    @ApiModelProperty(value = "当前分", example = "0")
    private Integer levelPoints;

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

    public String getLevelName() {
        return levelName;
    }

    public void setLevelName(String levelName) {
        this.levelName = levelName;
    }

    public Integer getMinPoints() {
        return minPoints;
    }

    public void setMinPoints(Integer minPoints) {
        this.minPoints = minPoints;
    }

    public Integer getMaxPoints() {
        return maxPoints;
    }

    public void setMaxPoints(Integer maxPoints) {
        this.maxPoints = maxPoints;
    }

    public Integer getLevelPoints() {
        return levelPoints;
    }

    public void setLevelPoints(Integer levelPoints) {
        this.levelPoints = levelPoints;
    }

    public UserInfoLevelVO toUserInfoLevelVO(User user){
        UserInfoLevelVO userInfoLevelVO = new UserInfoLevelVO();
        userInfoLevelVO.setUsername(user.getUsername());
        userInfoLevelVO.setEmail(user.getEmail());
        userInfoLevelVO.setPhone(user.getPhone());
        userInfoLevelVO.setNickname(user.getNickname());
        userInfoLevelVO.setAvatarUrl(user.getAvatarUrl());
        userInfoLevelVO.setGender(user.getGender());
        userInfoLevelVO.setBirthday(user.getBirthday());
        userInfoLevelVO.setLastLoginTime(user.getLastLoginTime());
        return userInfoLevelVO;
    }
}
