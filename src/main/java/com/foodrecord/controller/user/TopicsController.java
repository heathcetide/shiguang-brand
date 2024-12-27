package com.foodrecord.controller.user;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.Topics;
import com.foodrecord.service.IpBlockService;
import com.foodrecord.service.TopicsService;
import com.google.common.util.concurrent.RateLimiter;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/topic")
@Api(tags = "热点话题管理")
public class TopicsController {
    @Autowired
    private TopicsService topicsService;

    @Autowired
    private IpBlockService ipBlockService;

    @Autowired
    private StringRedisTemplate stringRedisTemplate;


    public static String TOPICS_ALL = "topics/all";

    public static String TOPIC_BY_ID = "topics/by-id";

//    @Autowired
//    private RedissonClient redissonClient;


    RateLimiter topicsRateLimiter = RateLimiter.create(500.0);

    private final ObjectMapper objectMapper = new ObjectMapper();

    @ApiOperation("获取所有话题")
    @GetMapping("/list")
    public ApiResponse<List<Topics>> getAllTopics(HttpServletRequest request) {
        //1.获取ip地址
        String clientIp = ipBlockService.getClientIp(request);
        //2.查看ip是否已经被封禁
        if (ipBlockService.isBlocked(clientIp)) {
            throw new RuntimeException("ip已经被封禁，请稍后再访问");
        }
        try {
            //3.进行限流操作，防止访问量过多
            if (!topicsRateLimiter.tryAcquire()) {
                throw new RuntimeException("流量访问过快，请稍后再试");
            }
        } catch (Exception e) {
            //4.出现访问异常封禁ip地址
            if (e.getMessage().contains("流量访问过快")) {
                ipBlockService.recordAbnormalAccess(clientIp);
            }
            throw e;
        }
        List<Topics> topicsList;
        try {
            //6.先查redis缓存中是否有
            String allTopics = stringRedisTemplate.opsForValue().get(TOPICS_ALL);
            if (allTopics == null) {
                //7.没有就从数据库中查找
                topicsList = topicsService.list();
                //8.缓存数据，无论有还是没有，可以预防一些缓存穿透问题
                if (topicsList.isEmpty()) {
                    //8.1如果是空数据则短时间缓存在redis中
                    stringRedisTemplate.opsForValue().set(TOPICS_ALL, "[]", 1, TimeUnit.MINUTES);
                } else {
                    //8.2如果有数据则较长时间保存
                    stringRedisTemplate.opsForValue().set(TOPICS_ALL, objectMapper.writeValueAsString(topicsList), 10, TimeUnit.MINUTES);
                }
            } else {
                //9.有就进行序列化操作
                topicsList = objectMapper.readValue(allTopics, new TypeReference<List<Topics>>() {
                });
            }
            //10返回相应的信息
            return ApiResponse.success(topicsList);
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    @ApiOperation("根据ID获取话题")
    @GetMapping("/{id}")
    public ApiResponse<Topics> getTopicById(@PathVariable Long id, HttpServletRequest request) {
        String clientIp = ipBlockService.getClientIp(request);
        if (ipBlockService.isBlocked(clientIp)) {
            throw new RuntimeException("该ip已被封禁，请稍后再试");
        }
        try {
            if (id < 0L) {
                throw new RuntimeException("参数不合法，请重试");
            }
            if (topicsRateLimiter.tryAcquire()) {
                throw new RuntimeException("该接口已被限流，请稍后再试");
            }
        } catch (Exception e) {
            if (e.getMessage().contains("参数不合法") || e.getMessage().contains("限流")) {
                ipBlockService.recordAbnormalAccess(clientIp);
            }
            throw e;
        }

        try {
            Topics topics = objectMapper.readValue(stringRedisTemplate.opsForValue().get(TOPIC_BY_ID + id), Topics.class);
            if (topics == null) {
                topics = topicsService.getById(id);
                if (topics == null) {
                    stringRedisTemplate.opsForValue().set(TOPIC_BY_ID + id, objectMapper.writeValueAsString(topics), 30, TimeUnit.SECONDS);
                }
                {
                    stringRedisTemplate.opsForValue().set(TOPIC_BY_ID + id, objectMapper.writeValueAsString(topics), 3, TimeUnit.MINUTES);
                }
            }
            if (topics != null) {
                return ApiResponse.success(topics);
            } else {
                return ApiResponse.error(300,"话题不存在");
            }
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    @ApiOperation("新增话题")
    @PostMapping("/add")
    public ApiResponse<String> addTopic(@RequestBody @Valid Topics topic) {
        // 获取分布式锁的 key
        String lockKey = "lock:topic:" + topic.getName();
        // 获取 Redisson 客户端
//        RLock lock = redissonClient.getLock(lockKey);
//
//        try {
//            // 尝试加锁，等待最多 5 秒，加锁后 10 秒自动释放
//            if (lock.tryLock(3, TimeUnit.SECONDS)) {
                // 检查是否已存在相同名称的话题
                Topics byId = topicsService.getTopicsByName(topic.getName());
                if (byId == null) {
                    // 插入新话题
                    boolean isSaved = topicsService.insert(topic);
                    if (isSaved) {
                        // 删除相关缓存
                        stringRedisTemplate.delete(TOPIC_BY_ID + topic.getId());
                        stringRedisTemplate.delete(TOPICS_ALL);

                        // 延迟删除缓存
                        Executors.newSingleThreadScheduledExecutor().schedule(() -> {
                            stringRedisTemplate.delete(TOPIC_BY_ID + topic.getId());
                            stringRedisTemplate.delete(TOPICS_ALL);
                        }, 500, TimeUnit.MILLISECONDS);

                        // 异步重建缓存
                        CompletableFuture.runAsync(this::rebuildTopicsCache);

                        return ApiResponse.success("新增话题成功");
                    } else {
                        return ApiResponse.error(300,"新增话题成功");
                    }
                } else {
                    return ApiResponse.error(300,"该话题已存在");
                }
//            } else {
//                // 如果未能获取锁，提示请求过多
//                result.setSuccess(false);
//                result.setMessage("请求过于频繁，请稍后再试");
//            }
//        } catch (InterruptedException e) {
//            Thread.currentThread().interrupt();
//            result.setSuccess(false);
//            result.setMessage("系统异常，请稍后再试");
//        } finally {
//            // 确保锁被释放
//            if (lock.isHeldByCurrentThread()) {
//                lock.unlock();
//            }
//        }
    }

    @ApiOperation("更新话题")
    @PutMapping("/update")
    public ApiResponse<String> updateTopic(@RequestBody Topics topic) {
        boolean isUpdated = topicsService.updateById(topic);
        if (isUpdated) {
            return ApiResponse.success("更新话题成功");
        } else {
            return ApiResponse.error(300,"更新话题失败");
        }
    }

    @ApiOperation("根据ID删除话题")
    @DeleteMapping("/delete/{id}")
    public ApiResponse<String> deleteTopic(@PathVariable Long id) {
        boolean isDeleted = topicsService.removeById(id);
        if (isDeleted) {

            return ApiResponse.success("删除话题成功");
        } else {
            return ApiResponse.error(300,"删除话题失败");
        }
    }

    @ApiOperation("根据名称查询话题")
    @GetMapping("/search")
    public ApiResponse<List<Topics>> searchTopicsByName(@RequestParam String name) {
        List<Topics> topicsList = topicsService.searchByName(name);
        return ApiResponse.success(topicsList);
    }

    @ApiOperation("热门话题列表（按热度排序）")
    @GetMapping("/hot")
    public ApiResponse<List<Topics>> getHotTopics() {
        List<Topics> hotTopics = topicsService.getHotTopics();
        if (hotTopics != null){
            return ApiResponse.success(hotTopics);
        }
        return ApiResponse.error(300, "没有帖子存在");
    }

    @ApiOperation("批量删除话题")
    @DeleteMapping("/delete/batch")
    public ApiResponse<String> deleteBatch(@RequestBody List<Long> ids) {
        boolean isDeleted = topicsService.removeByIds(ids);
        if (isDeleted) {
            return ApiResponse.success("批量删除成功");
        } else {
            return ApiResponse.success("批量删除失败");
        }
    }

    @ApiOperation("从Redis缓存中获取话题")
    @GetMapping("/cache/{id}")
    public ApiResponse<Topics> getTopicFromCache(@PathVariable Long id) throws JsonProcessingException {
        String cacheKey = "topic:" + id;
        String topicJson = stringRedisTemplate.opsForValue().get(cacheKey);
        if (topicJson != null) {
            Topics topic = objectMapper.readValue(topicJson, new TypeReference<>() {
            });
            return ApiResponse.success(topic);
        } else {
            Topics topic = topicsService.getByTopicId(id);
            if (topic != null) {
                stringRedisTemplate.opsForValue().set(cacheKey, objectMapper.writeValueAsString(topic), 10, TimeUnit.MINUTES);
                return ApiResponse.success(topic);
            } else {
                return ApiResponse.error(300,"该帖子不存在");
            }
        }
    }

    @ApiOperation("根据热度值过滤话题")
    @GetMapping("/filterByPopularity")
    public ApiResponse<List<Topics>> filterByPopularity(@RequestParam Integer minPopularity) {
        List<Topics> filteredTopics = topicsService.filterByPopularity(minPopularity);
        return ApiResponse.success(filteredTopics);
    }

    @Async
    public void rebuildTopicsCache() {
        List<Topics> topicsList = topicsService.list();
        try {
            stringRedisTemplate.opsForValue().set(TOPICS_ALL, objectMapper.writeValueAsString(topicsList), 10, TimeUnit.MINUTES);
        } catch (JsonProcessingException e) {
            e.printStackTrace();
        }
    }

}
