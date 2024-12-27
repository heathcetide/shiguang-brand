//package com.foodrecord.task;
//
//import com.cetide.cecomment.config.BloomFilterConfig;
//import com.cetide.cecomment.mapper.CommentMapper;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.stereotype.Component;
//
//import javax.annotation.PostConstruct;
//import java.util.List;
//
//@Component
//public class BloomFilterInit {
//
//    @Autowired
//    private CommentMapper commentMapper;
//
//    @PostConstruct
//    public void init() {
//        // 加载所有 postId
//        List<Long> postIds = commentMapper.getAllPostIds();
//        for (Long postId : postIds) {
//            BloomFilterConfig.put(postId);
//        }
//        System.out.println("布隆过滤器初始化完成，已加载 postId 数量：" + postIds.size());
//
//    }
//}
