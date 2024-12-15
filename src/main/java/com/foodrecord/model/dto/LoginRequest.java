package com.foodrecord.model.dto;

import javax.validation.constraints.NotBlank;

public class LoginRequest {
    @NotBlank(message = "用户名不能为空")
    private String username;
    
    @NotBlank(message = "密码不能为空")
    private String password;

    public @NotBlank(message = "用户名不能为空") String getUsername() {
        return username;
    }

    public void setUsername(@NotBlank(message = "用户名不能为空") String username) {
        this.username = username;
    }

    public @NotBlank(message = "密码不能为空") String getPassword() {
        return password;
    }

    public void setPassword(@NotBlank(message = "密码不能为空") String password) {
        this.password = password;
    }
}