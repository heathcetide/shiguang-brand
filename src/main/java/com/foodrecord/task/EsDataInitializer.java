package com.foodrecord.task;

import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.mapper.PostRepository;
import com.foodrecord.model.entity.Food;
import com.foodrecord.mapper.FoodRepository;
import com.foodrecord.model.entity.Post;
import com.foodrecord.model.es.PostDocument;
import com.foodrecord.service.PostService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.RecursiveTask;
import java.util.stream.Collectors;

import static com.foodrecord.constant.CommonConstants.BATCH_SIZE;

@Component
public class EsDataInitializer {

    @Resource
    private PostRepository postRepository;

    @Resource
    private PostService postService;

    private ForkJoinPool forkJoinPool = new ForkJoinPool();

    /**
     * 初始化时同步数据到 Elasticsearch
     */
//    @PostConstruct
    public void initPostDataToEs() {
        long totalPostCount = postService.getTotalCount();
        long batchCount = totalPostCount / BATCH_SIZE;
        if (totalPostCount % BATCH_SIZE != 0) {
            batchCount++;
        }
        List<Callable<Void>> tasks = new ArrayList<>();
        for (int i = 0; i < batchCount; i++){
            int offset = i * BATCH_SIZE;
            tasks.add(new LoadPostEsDataTask(offset, BATCH_SIZE));
        }
        forkJoinPool.invokeAll(tasks);
        System.out.println("ES 初始化数据同步完成，共同步：" + totalPostCount + " 条数据");
    }

    class LoadPostEsDataTask extends RecursiveTask<Void> implements Callable<Void> {

        private int offset;

        private int batchSize;

        LoadPostEsDataTask(int offset, int batchSize) {
            this.offset = offset;
            this.batchSize = batchSize;
        }

        @Override
        public Void call() {
            return compute();
        }

        @Override
        protected Void compute() {
            List<Post> postList = postService.userPosts(1, offset, offset + batchSize);
            // 仅存储需要检索的静态字段（避免同步修改频繁的字段）
            List<PostDocument> postEsList = postList.stream().map(post -> {
                PostDocument postEs = new PostDocument();
                postEs.setId(post.getId());
                postEs.setUserId(post.getUserId());
                postEs.setContent(post.getContent());
                postEs.setTags(post.getTags());
                postEs.setCreatedAt(post.getCreatedAt());
                postEs.setUpdatedAt(post.getUpdatedAt());
                postEs.setSuggest(post.getTags());
                return postEs;
            }).collect(Collectors.toList());
            // 批量存入 Elasticsearch
            postRepository.saveAll(postEsList);
            return null;
        }
    }


    @Autowired
    private FoodRepository foodRepository;

    @Resource
    private FoodMapper foodMapper;

    //    @PostConstruct
    public void init() {

        long totalFoodCount = foodMapper.countFoods();
        long batchCount = totalFoodCount / BATCH_SIZE;
        if (totalFoodCount % BATCH_SIZE != 0) {
            batchCount++;
        }
        List<Callable<Void>> tasks = new ArrayList<>();
        for (int i = 0; i < batchCount; i++) {
            int offset = i * BATCH_SIZE;
            tasks.add(new LoadFoodEsDataTask(offset, BATCH_SIZE));
        }
        System.out.println( "ES 初始化数据同步完成，共同步：" + totalFoodCount + " 条数据");
    }

    class LoadFoodEsDataTask extends RecursiveTask<Void> implements Callable<Void>{

        private int offset;

        private int batchSize;

        LoadFoodEsDataTask(int offset, int batchSize) {
            this.offset = offset;
            this.batchSize = batchSize;
        }

        @Override
        public Void call() {
            return compute();
        }

        @Override
        protected Void compute() {
            List<Food> foodList = foodMapper.selectFoodsByPage(offset, batchSize);
            for (Food food : foodList) {
                food.setPrompt(new String[]{food.getName(), food.getCode(), "健康", "营养", "美味"});
            }
            foodRepository.saveAll(foodList);
            return null;
        }
    }
}