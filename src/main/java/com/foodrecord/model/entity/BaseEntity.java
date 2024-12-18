package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableLogic;
<<<<<<< HEAD
<<<<<<< HEAD
import com.fasterxml.jackson.annotation.JsonFormat;

=======
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
import com.fasterxml.jackson.annotation.JsonFormat;

>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
import java.time.LocalDateTime;

public class BaseEntity {
    @TableField(fill = FieldFill.INSERT)
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "Asia/Shanghai")
    private LocalDateTime createdAt;
    
    @TableField(fill = FieldFill.INSERT_UPDATE)
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "Asia/Shanghai")
<<<<<<< HEAD
=======
    private LocalDateTime createdAt;
    
    @TableField(fill = FieldFill.INSERT_UPDATE)
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
    private LocalDateTime updatedAt;
    
    @TableLogic
    private Integer deleted;

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

    public Integer getDeleted() {
        return deleted;
    }

    public void setDeleted(Integer deleted) {
        this.deleted = deleted;
    }
}