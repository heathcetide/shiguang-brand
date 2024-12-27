package com.foodrecord.model.params;

import java.io.Serializable;
import java.util.List;

/**
 * 分页模型
 */
public class Paging<R> implements Serializable {

    private static final long serialVersionUID = 522660448543880825L;
    /**
     * 页数
     */
    private int pageNum = 1;

    /**
     * 每页数量
     */
    private int pageSize = 10;
    /**
     * 总页数
     */
    private int totalPage;

    /**
     * 总记录数
     */
    private long totalCount;

    /**
     * 集合数据
     */
    private List<R> data;

    public Paging() {

    }

    public Paging(int pageNum, int pageSize, int totalPage, long totalCount, List<R> data) {
        this.pageNum = pageNum;
        this.pageSize = pageSize;
        this.totalPage = totalPage;
        this.totalCount = totalCount;
        this.data = data;
    }

    public int getPageNum() {
        return pageNum;
    }

    public void setPageNum(int pageNum) {
        this.pageNum = pageNum;
    }

    public int getPageSize() {
        return pageSize;
    }

    public Paging setPageSize(int pageSize) {
        this.pageSize = pageSize;
        return this;
    }

    public int getTotalPage() {
        return totalPage;
    }

    public Paging setTotalPage(int totalPage) {
        this.totalPage = totalPage;
        return this;
    }

    public long getTotalCount() {
        return totalCount;
    }

    public Paging setTotalCount(long totalCount) {
        this.totalCount = totalCount;
        return this;
    }

    public List<R> getData() {
        return data;
    }

    public Paging setData(List<R> data) {
        this.data = data;
        return this;
    }

}
