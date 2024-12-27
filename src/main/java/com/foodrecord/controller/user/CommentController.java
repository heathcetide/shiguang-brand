package com.foodrecord.controller.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.common.utils.ThreadLocalUtil;
import com.foodrecord.model.dto.AddCommentRequest;
import com.foodrecord.model.entity.Comment;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.model.params.Paging;
import com.foodrecord.model.vo.CommentVO;
import com.foodrecord.service.CommentService;
import com.foodrecord.service.IpBlockService;
import com.foodrecord.service.UserService;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;
import com.google.common.util.concurrent.RateLimiter;
import io.lettuce.core.RedisCommandExecutionException;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.RedisSystemException;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;

import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

@RestController
@Api(tags = "评论接口")
@RequestMapping("/comment")
public class CommentController {
    @Resource
    private CommentService commentService;

//    @Resource
//    private UserActivitiesService userActivitiesService;

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private IpBlockService ipBlockService;

    @Autowired
    private UserService userService;

    public static Random rand = new Random();

    public static String KEY_COMMENT = "comment";

    public static Long KEY_COMMENT_TTL = 10L + rand.nextInt(3);

    public static Long KEY_COMMENT_EMPTY_TTL = 30L;

    public static Long LOCAL_COMMENT_CACHE_TTL = 2L;
    private final RateLimiter rateLimiter = RateLimiter.create(50.0); // 提高默认限流阈值

    @Scheduled(fixedRate = 5000) // 每 5 秒执行一次
    public void adjustRateLimiter() {
        long maxMemory = Runtime.getRuntime().maxMemory(); // 获取 JVM 可用的最大内存
        long usedMemory = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory(); // 获取已使用内存
        double memoryUsage = (double) usedMemory / maxMemory; // 计算内存使用率
//        System.out.println("内存使用量" + memoryUsage);
        double dynamicRateLimit;
        if (memoryUsage < 0.5) { // 内存使用率低于 50%，放宽限流
            dynamicRateLimit = 20.0;
        } else if (memoryUsage < 0.8) { // 内存使用率在 50%-80% 之间，保持中等限流
            dynamicRateLimit = 10.0;
        } else { // 内存使用率高于 80%，严格限流
            dynamicRateLimit = 5.0;
        }

        rateLimiter.setRate(dynamicRateLimit);
//        System.out.println("动态调整限流器，当前内存使用率：" + memoryUsage + "，当前限流阈值：" + dynamicRateLimit);
    }

    // Guava 本地缓存
    private final Cache<String, List<Comment>> localCache = CacheBuilder.newBuilder()
            .expireAfterWrite(LOCAL_COMMENT_CACHE_TTL, TimeUnit.SECONDS)
            .maximumSize(2000) // 增加缓存容量
            .recordStats() // 记录缓存统计
            .build();

    // 添加批量预热的线程池
    private final ExecutorService cacheWarmupExecutor = Executors.newFixedThreadPool(4);

    // 添加评论计数缓存
    private final LoadingCache<String, Long> commentCountCache = CacheBuilder.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .build(new CacheLoader<String, Long>() {
                @Override
                public Long load(String postId) {
                    return commentService.getCommentCount(postId);
                }
            });

    // 模拟获取热点帖子的ID列表
    private List<String> getHotPostIds() {
        // 从数据库或其他系统中获取热点帖子 ID
        // 例如可以是：访问量高的帖子，最新的帖子等等
        // 这里只是模拟一些ID
        ArrayList<String> hostPostIds = new ArrayList<>();
//        hostPostIds.add("1");
//        hostPostIds.add("2");
        return hostPostIds;
    }

    /**
     * 根据帖子ID获取评论列表
     *
     * @param postId
     * @param request
     * @return
     */
    @GetMapping("/get/byPostId")
    @ApiOperation(value = "根据帖子ID获取评论列表")
    public ApiResponse<List<CommentVO>> getCommentsByPostId(@RequestParam String postId, HttpServletRequest request) {
        try {
            // IP检查
            String clientIp = ipBlockService.getClientIp(request);
            if (ipBlockService.isBlocked(clientIp)) {
                return ApiResponse.error( 300,"IP被封禁，请稍后再试");
            }

            // 参数检查
            if (Long.parseLong(postId) < 0L) {
                return ApiResponse.error( 300, "参数错误");
            }

            // 限流检查
            if (!rateLimiter.tryAcquire()) {
                return ApiResponse.error( 300, "系统繁忙，请稍后再试");
            }

            // 查询Redis缓存
            String redisKey = KEY_COMMENT + postId;
            List<CommentVO> cachedComments = (List<CommentVO>) redisTemplate.opsForValue().get(redisKey);
            if (cachedComments != null) {
                return ApiResponse.success(cachedComments);
            }

            // 数据库查询
            List<Comment> comments = commentService.getCommentListBatch(postId);
            if (comments == null) {
                return ApiResponse.success( new ArrayList<>());
            }

            // 转换为VO对象
            List<CommentVO> voList = new ArrayList<>();
            for (Comment comment : comments) {
                CommentVO vo = new CommentVO();
                vo.setId(comment.getId());
                vo.setPostId(comment.getPostId());
                vo.setUserId(comment.getUserId());
                vo.setContent(comment.getContent());
                vo.setParentId(comment.getParentId());
                vo.setCreatedAt(comment.getCreatedAt());
                vo.setUpdatedAt(comment.getUpdatedAt());
                vo.setStatus(comment.getStatus());
                
                // 获取用户信息
                User user = userService.getUserById(comment.getUserId());
                if (user != null) {
                    vo.setNickname(user.getNickname());
                    vo.setAvatar(user.getAvatarUrl());
                }
                voList.add(vo);
            }

            // 异步更新缓存
            CompletableFuture.runAsync(() -> {
                try {
                    redisTemplate.opsForValue().set(redisKey, voList, 30, TimeUnit.SECONDS);
                } catch (Exception e) {
                    System.out.println("更新评论缓存失败: " + e.getMessage());
                }
            });

            return ApiResponse.success(voList);

        } catch (Exception e) {
            System.out.println("获取评论列表失败: " + e.getMessage());
            return ApiResponse.error(300, "获取评论失败");
        }
    }

    // 添加解压缩方法
    private String decompress(byte[] compressed) throws IOException {
        if (compressed == null || compressed.length == 0) {
            return "";
        }
        try (ByteArrayInputStream bis = new ByteArrayInputStream(compressed);
             GZIPInputStream gis = new GZIPInputStream(bis);
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {

            byte[] buffer = new byte[1024];
            int len;
            while ((len = gis.read(buffer)) > 0) {
                bos.write(buffer, 0, len);
            }
            return bos.toString(StandardCharsets.UTF_8.name());
        }
    }

    // 修改压缩方法，确保正确关闭资源
    private byte[] compress(String str) throws IOException {
        if (str == null || str.isEmpty()) {
            return new byte[0];
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(out)) {
            gzip.write(str.getBytes(StandardCharsets.UTF_8));
        }
        return out.toByteArray();
    }

    /**
     * 分页获取评论列表
     */
    // Guava 本地缓存
    private final Cache<String, Paging<Comment>> localpageCache = CacheBuilder.newBuilder()
            .expireAfterWrite(LOCAL_COMMENT_CACHE_TTL, TimeUnit.SECONDS)
            .maximumSize(1000) // 缓存最大容量，防止内存溢出
            .build();

    @GetMapping("/get/paged")
    @ApiOperation(value = "分页获取评论列表")
    public ApiResponse<Paging<Comment>> getPagedComments(
            @RequestParam(value = "pageNum", defaultValue = "1") Integer pageNum,
            @RequestParam(value = "pageSize", defaultValue = "15") Integer pageSize,
            HttpServletRequest request) {
        //获取客户端ip
        String clientIp = ipBlockService.getClientIp(request);
        //检查ip是否封禁
        if (ipBlockService.isBlocked(clientIp)) {
            throw new RuntimeException("ip已被封禁，请稍后再试");
        }

        String cacheKey = "PAGE_COMMENT" + pageNum + "_" + pageSize;
        try {
            //本地缓存检查
            Paging<Comment> cachedPaging = localpageCache.getIfPresent(cacheKey);
            if (cachedPaging != null) {
                return ApiResponse.success(cachedPaging);
            }
            String redisKey = "REDIS_" + "PAGE_COMMENT" + pageNum + "_" + pageSize;
            String redisData = (String) redisTemplate.opsForValue().get(redisKey);
            if (redisData != null) {
                ObjectMapper mapper = new ObjectMapper();
                Paging<Comment> redisPaging = mapper.readValue(redisData, Paging.class);
                localpageCache.put(cacheKey, redisPaging);
                return ApiResponse.success(redisPaging);
            }
            //限流
            if (!rateLimiter.tryAcquire()) {
                throw new RuntimeException("请求过于频繁，请稍后再试");
            }
            // 分页查询数据库
            Page<Comment> page = PageHelper.startPage(pageNum, pageSize)
                    .doSelectPage(() -> commentService.getList());
            Paging<Comment> paging = new Paging<>(page.getPageNum(), page.getPageSize(),
                    page.getPages(), page.getTotal(), page.getResult());
            // 更新缓存
            String serializedPaging = new ObjectMapper().writeValueAsString(paging);
            redisTemplate.opsForValue().set(redisKey, serializedPaging, 30, TimeUnit.SECONDS);
            localpageCache.put(cacheKey, paging);
            return ApiResponse.success(paging);
        } catch (RedisSystemException e) {
            if (e.getCause() instanceof RedisCommandExecutionException &&
                    e.getCause().getMessage().contains("WRONGTYPE")) {
                redisTemplate.delete("REDIS_" + cacheKey);
            } else {
                throw e;
            }
        } catch (Exception e) {
            System.err.println("获取评论分页失败：" + e.getMessage());
            throw new RuntimeException("服务异常，请稍后再试");
        }
        return ApiResponse.error(300,"获取帖子失败");
    }


    @PostMapping("/add")
    @ApiOperation(value = "添加新评论")
    public ApiResponse<Comment> addComment(@RequestBody AddCommentRequest addCommentRequest) {
        Map<String, Object> map = ThreadLocalUtil.get();
        Integer id = (Integer) map.get("id");
        Comment comment = addCommentRequest.toComment();
        comment.setUserId(Long.valueOf(id));
        comment.setCreatedAt(new Date());
        comment.setUpdatedAt(new Date());
        boolean save = commentService.insert(comment);
        if (save) {
            Long postId = addCommentRequest.getPostId();
//            userActivitiesService.createUserActivity(new UserActivities(comment.getUserId(), 3, postId)); // 保存用户评论活动
            updateCacheWithComment(comment, postId);
            //缓存重建
            return ApiResponse.success(comment);
        } else {
            return ApiResponse.error(300,"评论添加失败");
        }
    }

    @PutMapping("/update")
    @ApiOperation(value = "更新评论内容")
    public ApiResponse<Comment> updateComment(@RequestBody Comment comment) {
        boolean isSuccess = commentService.updateContent(comment);
        if (isSuccess) {
            Long postId = comment.getPostId();
            updateCacheWithComment(comment, postId);
            return ApiResponse.success(comment);
        } else {
            return ApiResponse.error(300,"更新失败");
        }
    }

    @DeleteMapping("/delete")
    @ApiOperation(value = "根据ID删除评论")
    public ApiResponse<Boolean> deleteComment(@RequestParam Long id) {
        if (id < 0) {
            throw new RuntimeException("参数不合法");
        }
        Comment comment = commentService.selectById(id);
        if (comment == null) {
            throw new CustomException("暂无此数据");
        }
        boolean isSuccess = commentService.delete(id);
        if (isSuccess) {
            // 延迟双删策略（第一次删除）
            redisTemplate.delete(KEY_COMMENT + comment.getPostId());
            // 延迟删除（第二次删除，延迟 500 毫秒）
            delayedDelete(KEY_COMMENT + comment.getPostId());
            // 使用异步任务重新构建缓存
            rebuildAffectedCache(comment.getPostId());
            return ApiResponse.success(true);
        } else {
            return ApiResponse.success(false);
        }
    }


    private void updateCacheWithComment(Comment comment, Long postId) {
        try {
            // 找到合适的分片进行插入
            AtomicInteger partIndex = new AtomicInteger(0); // 用于分片
            while (true) {
                String redisKey = KEY_COMMENT + postId + ":part" + partIndex;
                Long listSize = redisTemplate.opsForList().size(redisKey);
                if (listSize == null || listSize < 100) { // 找到未满的分片
                    redisTemplate.opsForList().rightPush(redisKey, new ObjectMapper().writeValueAsString(comment));
                    redisTemplate.expire(redisKey, KEY_COMMENT_TTL + (long) (Math.random() * 10), TimeUnit.MINUTES);
                    break;
                }
                partIndex.getAndIncrement(); // 尝试下一个分片
            }
        } catch (Exception e) {
            System.err.println("插入新评论缓存时出错: " + e.getMessage());
        }

        // 延迟双删策略（第一次删除）
        redisTemplate.delete(KEY_COMMENT + postId);
        // 延迟删除（第二次删除，延迟 500 毫秒）
        delayedDelete(KEY_COMMENT + postId);

        // 使用异步任务重新构建缓存
        rebuildAffectedCache(postId);
    }

    @Async
    public void delayedDelete(String redisKey) {
        try {
            TimeUnit.MILLISECONDS.sleep(500);
            redisTemplate.delete(redisKey);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Async
    public void rebuildAffectedCache(Long postId) {
        System.out.println("开始异步进行缓存重建，仅重建受影响的帖子 ID: " + postId);
        try {
            // 查询数据库中最新的评论
            List<Comment> comments = commentService.getCommentList(postId.toString());
            if (!comments.isEmpty()) {
                // 分片保存到 Redis 中，每个分片包含 100 条评论
                int batchSize = 100;
                List<String> serializedComments = new ArrayList<>();
                ObjectMapper mapper = new ObjectMapper();
                for (int i = 0; i < comments.size(); i++) {
                    serializedComments.add(mapper.writeValueAsString(comments.get(i)));
                    // 如果达到分片大小或者是最后一个元素，则将当前分片保存到 Redis
                    if ((i + 1) % batchSize == 0 || i == comments.size() - 1) {
                        String redisKey = KEY_COMMENT + postId + ":part" + (i / batchSize);
                        redisTemplate.opsForList().rightPushAll(redisKey, serializedComments);
                        redisTemplate.expire(redisKey, KEY_COMMENT_TTL, TimeUnit.MINUTES);
                        serializedComments.clear();
                    }
                }
                // 更新本地缓存
                localCache.put(postId.toString(), comments);
                System.out.println("缓存重建完成，帖子 ID: " + postId);
            } else {
                System.out.println("没有评论数据，跳过缓存重建，帖子 ID: " + postId);
            }
        } catch (Exception e) {
            System.err.println("缓存重建时出错，帖子 ID: " + postId + "，异常信息: " + e.getMessage());
        }
    }

    public void CacheCommentList() {
        // 假设你有一个方法可以获取热门帖子 ID 列表
        List<String> hotPostIds = getHotPostIds();
        if (hotPostIds.isEmpty()) {
            System.out.println("没有找到热点帖子进行缓存预热");
            return;
        }

        for (String postId : hotPostIds) {
            try {
                // 查询数据库中的评论
                List<Comment> comments = commentService.getCommentList(postId);
                if (!comments.isEmpty()) {
                    // 将评论保存到 Redis 缓存
                    String redisKey = KEY_COMMENT + postId;
                    for (Comment comment : comments) {
                        redisTemplate.opsForList().rightPush(redisKey, new ObjectMapper().writeValueAsString(comment));
                    }
                    redisTemplate.expire(redisKey, 10 + (long) (Math.random() * 10), TimeUnit.MINUTES); // 设置缓存过期时间
                    // 保存到本地缓存
                    localCache.put(postId, comments);
                    System.out.println("成功为帖子 ID " + postId + " 预热缓存");
                }
            } catch (Exception e) {
                System.err.println("缓存预热时出错，帖子 ID: " + postId + "，异常信息: " + e.getMessage());
            }
        }
    }

    // 优化缓存更新方法
    private void updateCacheAsync(String postId, List<Comment> comments) {
        CompletableFuture.runAsync(() -> {
            try {
                String redisKey = KEY_COMMENT + postId;
                // 直接存储对象，让RedisTemplate处理序列化
                redisTemplate.opsForValue().set(redisKey, comments);
                redisTemplate.expire(redisKey, KEY_COMMENT_TTL, TimeUnit.MINUTES);
                
                // 更新本地缓存
                localCache.put(postId, comments);
            } catch (Exception e) {
                System.out.println("更新缓存失败: " + e.getMessage());
            }
        });
    }

    // 优化缓存预热方法
    @PostConstruct
    public void preheatCache() {
        List<String> hotPostIds = getHotPostIds();
        // 并行预热缓存
        hotPostIds.parallelStream().forEach(postId -> {
            cacheWarmupExecutor.submit(() -> {
                try {
                    List<Comment> comments = commentService.getCommentListBatch(postId);
                    if (!comments.isEmpty()) {
                        updateCacheAsync(postId, comments);
                    }
                } catch (Exception e) {
                    System.out.println("缓存预热失败: " + postId + e);
                }
            });
        });
    }
}
