package com.foodrecord.model.dto;


/**
 * 导入结果项
 */
public class ImportResultItem {
    // 行号
    private int rowNum;
    
    // 是否成功
    private boolean success;
    
    // 消息
    private String message;

    public int getRowNum() {
        return rowNum;
    }

    public void setRowNum(int rowNum) {
        this.rowNum = rowNum;
    }

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public ImportResultItem() {}
    public ImportResultItem(int rowNum, boolean success, String message) {
        this.rowNum = rowNum;
        this.success = success;
        this.message = message;
    }
}