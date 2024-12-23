package com.foodrecord.model.dto;

import io.swagger.annotations.ApiModelProperty;

import javax.validation.constraints.Email;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

public class RegisterByEmail {

    @ApiModelProperty(value = "邮箱", example = "XXX@email")
    @NotBlank(message = "密码不能为空")
    @Email(message = "邮箱格式不正确")
    private String email;

    @ApiModelProperty(value = "邮箱验证码", example = "XXXXXX")
    @NotBlank(message = "密码不能为空")
    @Size(min = 6, max = 6, message = "验证码长度为六位")
    private String code;

    public @NotBlank(message = "密码不能为空") @Email(message = "邮箱格式不正确") String getEmail() {
        return email;
    }

    public void setEmail(@NotBlank(message = "密码不能为空") @Email(message = "邮箱格式不正确") String email) {
        this.email = email;
    }

    public @NotBlank(message = "密码不能为空") @Size(min = 6, max = 6, message = "验证码长度为六位") String getCode() {
        return code;
    }

    public void setCode(@NotBlank(message = "密码不能为空") @Size(min = 6, max = 6, message = "验证码长度为六位") String code) {
        this.code = code;
    }
}
