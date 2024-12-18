package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.PostMapper;
import com.foodrecord.model.entity.Post;
import com.foodrecord.service.PostService;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

/**
* @author Lenovo
* @description 针对表【post】的数据库操作Service实现
* @createDate 2024-12-02 21:47:52
*/
@Service
public class PostServiceImpl extends ServiceImpl<PostMapper, Post>
    implements PostService {

    @Resource
    private PostMapper postMapper;

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final Logger log = Logger.getLogger(PostServiceImpl.class.getName());

    @Override
    public List<Long> getHotPostIds() {
        try {
            // 从缓存获取热门帖子ID列表
            String cacheKey = "hot_post_ids";
            List<Long> hotPostIds = (List<Long>) redisTemplate.opsForValue().get(cacheKey);
            if (hotPostIds != null) {
                return hotPostIds;
            }

            // 从数据库查询热门帖子
            hotPostIds = postMapper.selectHotPostIds();
            
            // 更新缓存，设置5分钟过期
            if (hotPostIds != null && !hotPostIds.isEmpty()) {
                redisTemplate.opsForValue().set(cacheKey, hotPostIds, 5, TimeUnit.MINUTES);
            }
            
            return hotPostIds != null ? hotPostIds : new ArrayList<>();
        } catch (Exception e) {
            System.out.println("获取热门帖子ID失败"+ e);
            return new ArrayList<>();
        }
    }

    @Override
    public Post selectById(Long postId) {
        return postMapper.selectPostById(postId);
    }

    @Override
    public List<Post> getList() {
        return postMapper.getList();
    }

    @Override
    public Boolean updatePostById(Post post) {
        return postMapper.updatePostById(post);
    }
    @Override
    public Boolean upLikesCountById(Post post) {
        try {
            // 先查询当前帖子
            Post currentPost = postMapper.selectPostById(post.getId());
            if (currentPost == null) {
                return false;
            }
            
            // 确保likesCount不为null
            if (currentPost.getLikesCount() == null) {
                currentPost.setLikesCount(0);
            }
            
            // 设置新的点赞数
            currentPost.setLikesCount(currentPost.getLikesCount() + 1);
            
            return postMapper.upLikesCountById(currentPost);
        } catch (Exception e) {
            System.out.println("更新点赞数失败: " + e.getMessage());
            return false;
        }
    }

    @Override
    public Boolean insert(Post post) {
        return postMapper.save(post);
    }

    @Override
    public Post getPostById(Long postId) {
        return postMapper.selectPostById(postId);
    }

    @Override
    public Boolean downLikesCountById(Post post) {
        try {
            // 先查询当前帖子
            Post currentPost = postMapper.selectPostById(post.getId());
            if (currentPost == null) {
                return false;
            }
            
            // 确保likesCount不为null且大于0
            if (currentPost.getLikesCount() == null) {
                currentPost.setLikesCount(0);
            } else if (currentPost.getLikesCount() > 0) {
                // 设置新的点赞数
                currentPost.setLikesCount(currentPost.getLikesCount() - 1);
            }
            
            return postMapper.upLikesCountById(currentPost);
        } catch (Exception e) {
            System.out.println("更新点赞数失败: " + e.getMessage());
            return false;
        }
    }

    @Override
    @Transactional
    public boolean saveAll(List<Post> posts) {
        for (Post post : posts) {
            post.setContent(cleanContent(post.getContent()));
            post.setUserId(1L);
            postMapper.save(post);
        }
        return true;
    }

    private String cleanContent(String content) {
        // 去除 HTML 标签
        String noHtmlContent = content.replaceAll("<[^>]*>", "");

        // 去除 Markdown 格式
        String noMarkdownContent = noHtmlContent.replaceAll("\\[.*?\\]\\(.*?\\)", "");

        // 其他特殊字符处理
        String safeContent = noMarkdownContent.replace("'", "''"); // 双引号闭合

        return safeContent;
    }
}




