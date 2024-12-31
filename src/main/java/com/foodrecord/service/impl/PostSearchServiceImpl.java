package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.model.entity.Post;
import com.foodrecord.model.es.PostDocument;
import com.foodrecord.model.vo.PostSearchVO;
import com.foodrecord.repository.PostRepository;
import com.foodrecord.service.PostSearchService;
import org.elasticsearch.action.search.SearchRequest;
import org.elasticsearch.action.search.SearchResponse;
import org.elasticsearch.client.RequestOptions;
import org.elasticsearch.client.RestHighLevelClient;
import org.elasticsearch.common.lucene.search.function.CombineFunction;
import org.elasticsearch.common.lucene.search.function.FunctionScoreQuery;
import org.elasticsearch.index.query.BoolQueryBuilder;
import org.elasticsearch.index.query.QueryBuilders;
import org.elasticsearch.index.query.functionscore.FunctionScoreQueryBuilder;
import org.elasticsearch.index.query.functionscore.ScoreFunctionBuilder;
import org.elasticsearch.index.query.functionscore.ScoreFunctionBuilders;
import org.elasticsearch.index.query.functionscore.ScriptScoreFunctionBuilder;
import org.elasticsearch.script.Script;
import org.elasticsearch.search.SearchHit;
import org.elasticsearch.search.aggregations.AggregationBuilders;
import org.elasticsearch.search.aggregations.bucket.histogram.DateHistogramInterval;
import org.elasticsearch.search.aggregations.bucket.terms.Terms;
import org.elasticsearch.search.builder.SearchSourceBuilder;
import org.elasticsearch.search.fetch.subphase.highlight.HighlightBuilder;
import org.elasticsearch.search.sort.SortBuilders;
import org.elasticsearch.search.sort.SortOrder;
import org.elasticsearch.search.suggest.SuggestBuilder;
import org.elasticsearch.search.suggest.SuggestBuilders;
import org.elasticsearch.search.suggest.completion.CompletionSuggestion;
import org.springframework.beans.BeanUtils;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.elasticsearch.core.ElasticsearchRestTemplate;
import org.springframework.data.elasticsearch.core.SearchHits;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;
import org.springframework.data.elasticsearch.core.query.NativeSearchQuery;
import org.springframework.data.elasticsearch.core.query.NativeSearchQueryBuilder;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.io.IOException;
import java.time.LocalDateTime;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class PostSearchServiceImpl implements PostSearchService {

    @Resource
    private PostRepository postRepository;

    @Resource
    private ElasticsearchRestTemplate elasticsearchRestTemplate;

    @Resource
    private RestHighLevelClient restHighLevelClient;

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final String SEARCH_HISTORY_KEY = "search:history:";
    private static final String HOT_SEARCH_KEY = "search:hot";

    @Override
    public Page<Post> search(String keyword, Page<Post> page) {
        // 构建多字段搜索查询
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery()
                .should(QueryBuilders.multiMatchQuery(keyword, "content", "tags")
                        .fuzziness("AUTO")
                        .minimumShouldMatch("70%"));

        // 构建高亮
        HighlightBuilder highlightBuilder = new HighlightBuilder()
                .field("content")
                .field("tags")
                .preTags("<em>")
                .postTags("</em>");

        // 构建搜索请求
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .withQuery(boolQuery)
                .withHighlightBuilder(highlightBuilder)
                .withPageable(PageRequest.of((int) (page.getCurrent() - 1), (int) page.getSize()))
                .withSort(SortBuilders.scoreSort().order(SortOrder.DESC))
                .build();

        // 执行搜索
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class,
                IndexCoordinates.of("posts")
        );

        // 处理结果
        List<Post> posts = new ArrayList<>();
        searchHits.forEach(hit -> {
            PostDocument document = hit.getContent();
            Post post = new Post();
            BeanUtils.copyProperties(document, post);
            
            // 处理高亮
            Map<String, List<String>> highlightFields = hit.getHighlightFields();
            if (highlightFields.containsKey("content")) {
                post.setContent(highlightFields.get("content").get(0));
            }
            if (highlightFields.containsKey("tags")) {
                post.setTags(highlightFields.get("tags").get(0));
            }
            
            posts.add(post);
        });

        // 设置分页信息
        page.setRecords(posts);
        page.setTotal(searchHits.getTotalHits());
        
        return page;
    }

    @Override
    public Page<Post> advancedSearch(PostSearchVO searchVO, Page<Post> page) {
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery();

        // 关键词搜索
        if (searchVO.getKeyword() != null && !searchVO.getKeyword().isEmpty()) {
            boolQuery.must(QueryBuilders.multiMatchQuery(searchVO.getKeyword(), "content", "tags")
                    .fuzziness("AUTO")
                    .minimumShouldMatch("70%"));
        }

        // 标签过滤
        if (searchVO.getTags() != null && !searchVO.getTags().isEmpty()) {
            searchVO.getTags().forEach(tag -> 
                boolQuery.must(QueryBuilders.termQuery("tags", tag)));
        }

        // 用户过滤
        if (searchVO.getUserId() != null) {
            boolQuery.must(QueryBuilders.termQuery("userId", searchVO.getUserId()));
        }

        // 时间范围过滤
        if (searchVO.getStartTime() != null || searchVO.getEndTime() != null) {
            BoolQueryBuilder timeQuery = QueryBuilders.boolQuery();
            if (searchVO.getStartTime() != null) {
                timeQuery.must(QueryBuilders.rangeQuery("createdAt").gte(searchVO.getStartTime()));
            }
            if (searchVO.getEndTime() != null) {
                timeQuery.must(QueryBuilders.rangeQuery("createdAt").lte(searchVO.getEndTime()));
            }
            boolQuery.must(timeQuery);
        }

        // 点赞数过滤
        if (searchVO.getMinLikes() != null) {
            boolQuery.must(QueryBuilders.rangeQuery("likesCount").gte(searchVO.getMinLikes()));
        }

        // 评论数过滤
        if (searchVO.getMinComments() != null) {
            boolQuery.must(QueryBuilders.rangeQuery("commentsCount").gte(searchVO.getMinComments()));
        }

        // 置顶过滤
        if (searchVO.getOnlyPinned() != null && searchVO.getOnlyPinned()) {
            boolQuery.must(QueryBuilders.termQuery("isPinned", true));
        }

        // 构建查询
        NativeSearchQueryBuilder queryBuilder = new NativeSearchQueryBuilder()
                .withQuery(boolQuery)
                .withHighlightFields(
                        new HighlightBuilder.Field("content").preTags("<em>").postTags("</em>"),
                        new HighlightBuilder.Field("tags").preTags("<em>").postTags("</em>")
                )
                .withPageable(PageRequest.of((int) (page.getCurrent() - 1), (int) page.getSize()));

        // 添加排序
        if (searchVO.getSortField() != null && !searchVO.getSortField().isEmpty()) {
            SortOrder sortOrder = "desc".equalsIgnoreCase(searchVO.getSortOrder()) ? 
                    SortOrder.DESC : SortOrder.ASC;
            queryBuilder.withSort(SortBuilders.fieldSort(searchVO.getSortField()).order(sortOrder));
        }

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                queryBuilder.build(), 
                PostDocument.class
        );

        // 处理结果
        List<Post> posts = searchHits.getSearchHits().stream()
                .map(hit -> {
                    PostDocument doc = hit.getContent();
                    Post post = new Post();
                    BeanUtils.copyProperties(doc, post);

                    // 处理高亮
                    Map<String, List<String>> highlightFields = hit.getHighlightFields();
                    if (highlightFields.containsKey("content")) {
                        post.setContent(highlightFields.get("content").get(0));
                    }
                    if (highlightFields.containsKey("tags")) {
                        post.setTags(highlightFields.get("tags").get(0));
                    }

                    return post;
                })
                .collect(Collectors.toList());

        page.setRecords(posts);
        page.setTotal(searchHits.getTotalHits());

        return page;
    }

    @Override
    public Page<Post> searchByTimeRange(LocalDateTime startTime, LocalDateTime endTime, Page<Post> page) {
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery()
                .must(QueryBuilders.rangeQuery("createdAt")
                        .from(startTime)
                        .to(endTime));

        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .withQuery(boolQuery)
                .withPageable(PageRequest.of((int) (page.getCurrent() - 1), (int) page.getSize()))
                .withSort(SortBuilders.fieldSort("createdAt").order(SortOrder.DESC))
                .build();

        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery, 
                PostDocument.class
        );

        List<Post> posts = searchHits.getSearchHits().stream()
                .map(hit -> {
                    Post post = new Post();
                    BeanUtils.copyProperties(hit.getContent(), post);
                    return post;
                })
                .collect(Collectors.toList());

        page.setRecords(posts);
        page.setTotal(searchHits.getTotalHits());

        return page;
    }

    @Override
    public List<Post> getSimilarPosts(Long postId, int limit) {
        // 获取当前帖子
        Optional<PostDocument> postDoc = postRepository.findById(postId);
        if (!postDoc.isPresent()) {
            return new ArrayList<>();
        }

        PostDocument currentPost = postDoc.get();

        // 构建相似度查询
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery()
                .should(QueryBuilders.moreLikeThisQuery(
                        new String[]{"content", "tags"}
//                        ,new String[]{currentPost.getContent(), String.join(" ", currentPost.getTags())}
                        )
                        .minTermFreq(1)
                        .maxQueryTerms(12))
                .mustNot(QueryBuilders.termQuery("id", postId));

        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .withQuery(boolQuery)
                .withPageable(PageRequest.of(0, limit))
                .build();

        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        return searchHits.getSearchHits().stream()
                .map(hit -> {
                    Post post = new Post();
                    BeanUtils.copyProperties(hit.getContent(), post);
                    return post;
                })
                .collect(Collectors.toList());
    }

    @Override
    public List<Map<String, Object>> getHotSearchWords(int limit) {
        Set<Object> hotSearches = redisTemplate.opsForZSet()
                .reverseRange(HOT_SEARCH_KEY, 0, limit - 1);
        
        if (hotSearches == null) {
            return new ArrayList<>();
        }

        return hotSearches.stream()
                .map(word -> {
                    Map<String, Object> result = new HashMap<>();
                    result.put("keyword", word);
                    Double score = redisTemplate.opsForZSet().score(HOT_SEARCH_KEY, word);
                    result.put("count", score != null ? score.longValue() : 0);
                    return result;
                })
                .collect(Collectors.toList());
    }

    @Override
    public void saveSearchHistory(Long userId, String keyword) {
        String key = SEARCH_HISTORY_KEY + userId;
        
        // 保存到用户的搜索历史
        redisTemplate.opsForZSet().add(key, keyword, System.currentTimeMillis());
        
        // 只保留最近100条记录
        redisTemplate.opsForZSet().removeRange(key, 0, -101);

        // 更新热门搜索词
        redisTemplate.opsForZSet().incrementScore(HOT_SEARCH_KEY, keyword, 1);
    }

    @Override
    public List<String> getUserSearchHistory(Long userId, int limit) {
        Set<Object> history = redisTemplate.opsForZSet()
                .reverseRange(SEARCH_HISTORY_KEY + userId, 0, limit - 1);
        
        return history == null ? new ArrayList<>() :
                history.stream()
                        .map(Object::toString)
                        .collect(Collectors.toList());
    }

    @Override
    public Map<String, Long> aggregateByTags() {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .addAggregation(AggregationBuilders.terms("tags_agg")
                        .field("tags.keyword")
                        .size(50))
                .build();

        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        Terms terms = searchHits.getAggregations().get("tags_agg");
        return terms.getBuckets().stream()
                .collect(Collectors.toMap(
                        Terms.Bucket::getKeyAsString,
                        Terms.Bucket::getDocCount
                ));
    }

    @Override
    public List<String> suggest(String prefix) {
        // 构建建议查询
        SuggestBuilder suggestBuilder = new SuggestBuilder()
                .addSuggestion("tag_suggest",
                        SuggestBuilders.completionSuggestion("suggest")
                                .prefix(prefix)
                                .size(10));

        // 构建搜索请求
        SearchRequest searchRequest = new SearchRequest("posts")
                .source(new SearchSourceBuilder().suggest(suggestBuilder));

        try {
            // 执行查询
            SearchResponse response = restHighLevelClient.search(searchRequest, RequestOptions.DEFAULT);

            // 处理结果
            List<String> suggestions = new ArrayList<>();
            CompletionSuggestion suggestion = response.getSuggest().getSuggestion("tag_suggest");
            suggestion.getEntries().forEach(entry ->
                    entry.getOptions().forEach(option ->
                            suggestions.add(option.getText().string())
                    )
            );

            return suggestions;
        } catch (IOException e) {
            throw new RuntimeException("Failed to get suggestions", e);
        }
    }

    @Override
    public void syncToES(Post post) {
        PostDocument document = new PostDocument();
        BeanUtils.copyProperties(post, document);
        postRepository.save(document);
    }

    @Override
    public void syncBatchToES(List<Post> posts) {
        List<PostDocument> documents = posts.stream()
                .map(post -> {
                    PostDocument document = new PostDocument();
                    BeanUtils.copyProperties(post, document);
                    return document;
                })
                .collect(Collectors.toList());
        postRepository.saveAll(documents);
    }

    @Override
    public void deleteFromES(Long postId) {
        postRepository.deleteById(postId);
    }

    @Override
    public List<Map<String, Object>> getHotTopics(int days, int limit) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        
        // 构建时间范围查询
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery()
                .must(QueryBuilders.rangeQuery("createdAt").gte(startTime));

        // 构建聚合查询
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .withQuery(boolQuery)
                .addAggregation(AggregationBuilders.terms("topics")
                        .field("tags.keyword")
                        .size(limit)
                        .subAggregation(AggregationBuilders.sum("likes").field("likesCount"))
                        .subAggregation(AggregationBuilders.sum("comments").field("commentsCount"))
                        .order(org.elasticsearch.search.aggregations.BucketOrder.count(false)))
                .build();

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        // 处理结果
        Terms terms = searchHits.getAggregations().get("topics");
        return terms.getBuckets().stream()
                .map(bucket -> {
                    Map<String, Object> topic = new HashMap<>();
                    topic.put("tag", bucket.getKeyAsString());
                    topic.put("count", bucket.getDocCount());
                    topic.put("likes", ((org.elasticsearch.search.aggregations.metrics.Sum) bucket.getAggregations().get("likes")).getValue());
                    topic.put("comments", ((org.elasticsearch.search.aggregations.metrics.Sum) bucket.getAggregations().get("comments")).getValue());
                    return topic;
                })
                .collect(Collectors.toList());
    }

    @Override
    public List<Post> getPersonalizedRecommendations(Long userId, int limit) {
        // 1. 获取用户的历史行为数据
        BoolQueryBuilder userHistoryQuery = QueryBuilders.boolQuery()
                .must(QueryBuilders.termQuery("userId", userId));

        NativeSearchQuery historySearchQuery = new NativeSearchQueryBuilder()
                .withQuery(userHistoryQuery)
                .addAggregation(AggregationBuilders.terms("user_tags")
                        .field("tags.keyword")
                        .size(20))
                .build();

        SearchHits<PostDocument> userHits = elasticsearchRestTemplate.search(
                historySearchQuery,
                PostDocument.class
        );

        // 2. 提取用户感兴趣的标签
        Terms userTags = userHits.getAggregations().get("user_tags");
        List<String> interestedTags = userTags.getBuckets().stream()
                .map(Terms.Bucket::getKeyAsString)
                .collect(Collectors.toList());

        // 3. 构建推荐查询
        BoolQueryBuilder recommendationQuery = QueryBuilders.boolQuery();
        
        // 3.1 基于标签的推荐
        if (!interestedTags.isEmpty()) {
            BoolQueryBuilder tagQuery = QueryBuilders.boolQuery();
            interestedTags.forEach(tag ->
                    tagQuery.should(QueryBuilders.matchQuery("tags", tag)));
            recommendationQuery.must(tagQuery);
        }

        // 3.2 排除用户自己的帖子
        recommendationQuery.mustNot(QueryBuilders.termQuery("userId", userId));

        // 3.3 时间衰减函数
        ScoreFunctionBuilder<?> timeDecayFunction =
                ScoreFunctionBuilders.exponentialDecayFunction("createdAt",
                        "now", "30d", "7d", 0.5);

        // 3.4 热度提升函数
        ScriptScoreFunctionBuilder popularityBoostFunction = ScoreFunctionBuilders.scriptFunction(
                new Script("Math.log10(2 + doc['likesCount'].value + doc['commentsCount'].value * 2)"));

        // 3.5 组合所有评分函数
        FunctionScoreQueryBuilder functionScoreQuery = QueryBuilders.functionScoreQuery(
                recommendationQuery,
                new FunctionScoreQueryBuilder.FilterFunctionBuilder[]{
                        new FunctionScoreQueryBuilder.FilterFunctionBuilder(timeDecayFunction),
                        new FunctionScoreQueryBuilder.FilterFunctionBuilder(popularityBoostFunction)
                })
                .scoreMode(FunctionScoreQuery.ScoreMode.MULTIPLY)
                .boostMode(CombineFunction.MULTIPLY);

        // 4. 执行推荐查询
        NativeSearchQuery recommendationSearchQuery = new NativeSearchQueryBuilder()
                .withQuery(functionScoreQuery)
                .withPageable(PageRequest.of(0, limit))
                .build();

        SearchHits<PostDocument> recommendationHits = elasticsearchRestTemplate.search(
                recommendationSearchQuery,
                PostDocument.class
        );

        // 5. 处理结果
        return recommendationHits.getSearchHits().stream()
                .map(hit -> {
                    Post post = new Post();
                    BeanUtils.copyProperties(hit.getContent(), post);
                    return post;
                })
                .collect(Collectors.toList());
    }

    @Override
    public List<Map<String, Object>> getHotLocations(int limit) {
        // 构建地点提取的聚合查询
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .addAggregation(AggregationBuilders.terms("locations")
                        .field("location.keyword")
                        .size(limit)
                        .subAggregation(AggregationBuilders.sum("popularity")
                                .field("likesCount")))
                .build();

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        // 处理结果
        Terms terms = searchHits.getAggregations().get("locations");
        return terms.getBuckets().stream()
                .map(bucket -> {
                    Map<String, Object> location = new HashMap<>();
                    location.put("name", bucket.getKeyAsString());
                    location.put("count", bucket.getDocCount());
                    location.put("popularity", ((org.elasticsearch.search.aggregations.metrics.Sum) bucket.getAggregations().get("popularity")).getValue());
                    return location;
                })
                .collect(Collectors.toList());
    }

    @Override
    public Map<String, Object> analyzeSentiment(Long postId) {
        // 获取帖子内容
        Optional<PostDocument> postDoc = postRepository.findById(postId);
        if (!postDoc.isPresent()) {
            return new HashMap<>();
        }

        // 使用简单的情感词典进行分析
        String content = postDoc.get().getContent();
        Map<String, Object> result = new HashMap<>();
        
        // 计算积极和消极词的出现次数
        long positiveCount = countSentimentWords(content, getPositiveWords());
        long negativeCount = countSentimentWords(content, getNegativeWords());

        // 计算情感得分
        double score = (positiveCount - negativeCount) / (double) (positiveCount + negativeCount + 1);
        
        result.put("score", score);
        result.put("sentiment", score > 0.1 ? "positive" : (score < -0.1 ? "negative" : "neutral"));
        result.put("positiveCount", positiveCount);
        result.put("negativeCount", negativeCount);
        
        return result;
    }

    @Override
    public List<Map<String, Object>> getTrends(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);

        // 构建时间序列聚合查询
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .withQuery(QueryBuilders.rangeQuery("createdAt").gte(startTime))
                .addAggregation(AggregationBuilders.dateHistogram("trends")
                        .field("createdAt")
                        .calendarInterval(DateHistogramInterval.DAY)
                        .subAggregation(AggregationBuilders.terms("tags")
                                .field("tags.keyword")
                                .size(10)))
                .build();

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        // 处理结果
        org.elasticsearch.search.aggregations.bucket.histogram.Histogram histogram = 
                searchHits.getAggregations().get("trends");
        
        return histogram.getBuckets().stream()
                .map(bucket -> {
                    Map<String, Object> trend = new HashMap<>();
                    trend.put("date", bucket.getKeyAsString());
                    trend.put("count", bucket.getDocCount());
                    
                    Terms tagTerms = bucket.getAggregations().get("tags");
                    trend.put("topTags", tagTerms.getBuckets().stream()
                            .map(tagBucket -> Map.of(
                                    "tag", tagBucket.getKeyAsString(),
                                    "count", tagBucket.getDocCount()))
                            .collect(Collectors.toList()));
                    
                    return trend;
                })
                .collect(Collectors.toList());
    }

    @Override
    public List<Map<String, Object>> getSimilarUsers(Long userId, int limit) {
        // 获取用户的帖子标签
        BoolQueryBuilder userQuery = QueryBuilders.boolQuery()
                .must(QueryBuilders.termQuery("userId", userId));
        
        NativeSearchQuery queryBuilder = new NativeSearchQueryBuilder()
                .withQuery(userQuery)
                .addAggregation(AggregationBuilders.terms("user_tags")
                        .field("tags.keyword")
                        .size(20))
                .build();

        SearchHits<PostDocument> userHits = elasticsearchRestTemplate.search(
                queryBuilder,
                PostDocument.class
        );

        Terms userTags = userHits.getAggregations().get("user_tags");
        List<String> tags = userTags.getBuckets().stream()
                .map(Terms.Bucket::getKeyAsString)
                .collect(Collectors.toList());

        if (tags.isEmpty()) {
            return new ArrayList<>();
        }

        // 查找具有相似标签的其他用户
        BoolQueryBuilder similarQuery = QueryBuilders.boolQuery();
        tags.forEach(tag ->
                similarQuery.should(QueryBuilders.matchQuery("tags", tag)));
        similarQuery.minimumShouldMatch(1)
                .mustNot(QueryBuilders.termQuery("userId", userId));

        NativeSearchQuery similarUsersQuery = new NativeSearchQueryBuilder()
                .withQuery(similarQuery)
                .addAggregation(AggregationBuilders.terms("similar_users")
                        .field("userId")
                        .size(limit)
                        .subAggregation(AggregationBuilders.terms("common_tags")
                                .field("tags.keyword")
                                .size(10)))
                .build();

        SearchHits<PostDocument> similarHits = elasticsearchRestTemplate.search(
                similarUsersQuery,
                PostDocument.class
        );

        Terms similarUsers = similarHits.getAggregations().get("similar_users");
        return similarUsers.getBuckets().stream()
                .map(bucket -> {
                    Map<String, Object> user = new HashMap<>();
                    user.put("userId", bucket.getKeyAsString());
                    user.put("postCount", bucket.getDocCount());
                    
                    Terms commonTags = bucket.getAggregations().get("common_tags");
                    user.put("commonTags", commonTags.getBuckets().stream()
                            .map(Terms.Bucket::getKeyAsString)
                            .collect(Collectors.toList()));

                    return user;
                })
                .collect(Collectors.toList());
    }

    @Override
    public Map<String, Long> getHotTimeDistribution(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);

        // 构建时间分布聚合查询
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .withQuery(QueryBuilders.rangeQuery("createdAt").gte(startTime))
                .addAggregation(AggregationBuilders.dateHistogram("time_dist")
                        .field("createdAt")
                        .calendarInterval(DateHistogramInterval.HOUR))
                .build();

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        // 处理结果
        org.elasticsearch.search.aggregations.bucket.histogram.Histogram histogram = 
                searchHits.getAggregations().get("time_dist");
        
        Map<String, Long> distribution = new HashMap<>();
        histogram.getBuckets().forEach(bucket -> 
                distribution.put(bucket.getKeyAsString(), bucket.getDocCount()));
        
        return distribution;
    }

    @Override
    public List<Map<String, Object>> getTagRelations(String tagName, int limit) {
        // 查找包含指定标签的帖子
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery()
                .must(QueryBuilders.matchQuery("tags", tagName));

        // 构建关联标签聚合查询
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .withQuery(boolQuery)
                .addAggregation(AggregationBuilders.terms("related_tags")
                        .field("tags.keyword")
                        .size(limit + 1) // +1 是为了排除当前标签
                        .subAggregation(AggregationBuilders.sum("relevance")
                                .field("likesCount")))
                .build();

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        // 处理结果
        Terms terms = searchHits.getAggregations().get("related_tags");
        return terms.getBuckets().stream()
                .filter(bucket -> !bucket.getKeyAsString().equals(tagName))
                .map(bucket -> {
                    Map<String, Object> relation = new HashMap<>();
                    relation.put("tag", bucket.getKeyAsString());
                    relation.put("count", bucket.getDocCount());
                    relation.put("relevance", ((org.elasticsearch.search.aggregations.metrics.Sum) bucket.getAggregations().get("relevance")).getValue());
                    return relation;
                })
                .collect(Collectors.toList());
    }

    @Override
    public Map<String, Object> getContentQualityScore(Long postId) {
        // 获取帖子
        Optional<PostDocument> postDoc = postRepository.findById(postId);
        if (!postDoc.isPresent()) {
            return new HashMap<>();
        }

        PostDocument doc = postDoc.get();
        Map<String, Object> scores = new HashMap<>();

        // 计算内容长度得分
        int contentLength = doc.getContent().length();
        double lengthScore = Math.min(contentLength / 500.0, 1.0) * 100;
        scores.put("lengthScore", lengthScore);

        // 计算互动得分
        double interactionScore = (doc.getLikesCount() + doc.getCommentsCount() * 2) / 10.0;
        interactionScore = Math.min(interactionScore, 100);
        scores.put("interactionScore", interactionScore);

        // 计算标签丰富度得分
        int tagCount = doc.getTags() != null ? doc.getTags().split(",").length : 0;
        double tagScore = Math.min(tagCount / 5.0, 1.0) * 100;
        scores.put("tagScore", tagScore);

        // 计算时效性得分
        long daysOld = java.time.temporal.ChronoUnit.DAYS.between(doc.getCreatedAt(), LocalDateTime.now());
        double freshnessScore = Math.max(0, (30 - daysOld) / 30.0) * 100;
        scores.put("freshnessScore", freshnessScore);

        // 计算总分
        double totalScore = (lengthScore + interactionScore + tagScore + freshnessScore) / 4;
        scores.put("totalScore", totalScore);

        return scores;
    }

    @Override
    public List<Map<String, Object>> getContentQualityList(int limit) {
        // 构建质量分析聚合查询
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .addAggregation(AggregationBuilders.terms("quality_levels")
                        .script(new Script(
                                "double score = 0;" +
                                "score += Math.min(doc['content'].value.length() / 500.0, 1.0) * 25;" +
                                "score += Math.min((doc['likesCount'].value + doc['commentsCount'].value * 2) / 10.0, 1.0) * 50;" +
                                "score += Math.min(doc['tags'].length / 5.0, 1.0) * 25;" +
                                "return Math.round(score / 10) * 10;"))
                        .size(10))
                .build();

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        // 处理结果
        Terms terms = searchHits.getAggregations().get("quality_levels");
        return terms.getBuckets().stream()
                .map(bucket -> {
                    Map<String, Object> level = new HashMap<>();
                    level.put("score", bucket.getKeyAsString());
                    level.put("count", bucket.getDocCount());
                    return level;
                })
                .collect(Collectors.toList());
    }

    @Override
    public List<Map<String, Object>> getSensitiveWordsList(int limit) {
        // 从配置或数据库加载敏感词列表
        Set<String> sensitiveWords = getSensitiveWords();
        
        // 构建敏感词检测查询
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery();
        sensitiveWords.forEach(word ->
                boolQuery.should(QueryBuilders.matchPhraseQuery("content", word)));

        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .withQuery(boolQuery)
                .withPageable(PageRequest.of(0, limit))
                .build();

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        // 处理结果
        return searchHits.getSearchHits().stream()
                .map(hit -> {
                    Map<String, Object> result = new HashMap<>();
                    PostDocument doc = hit.getContent();
                    result.put("postId", doc.getId());
                    result.put("content", doc.getContent());
                    result.put("userId", doc.getUserId());
                    result.put("createdAt", doc.getCreatedAt());
                    
                    // 检测命中的敏感词
                    Set<String> hitWords = sensitiveWords.stream()
                            .filter(word -> doc.getContent().toLowerCase().contains(word.toLowerCase()))
                            .collect(Collectors.toSet());
                    result.put("sensitiveWords", hitWords);
                    
                    return result;
                })
                .collect(Collectors.toList());
    }

    @Override
    public Map<String, Object> getUserBehaviorAnalysis(Long userId, int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        
        // 构建用户行为分析查询
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery()
                .must(QueryBuilders.termQuery("userId", userId))
                .must(QueryBuilders.rangeQuery("createdAt").gte(startTime));

        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .withQuery(boolQuery)
                .addAggregation(AggregationBuilders.dateHistogram("posting_trend")
                        .field("createdAt")
                        .calendarInterval(DateHistogramInterval.DAY))
                .addAggregation(AggregationBuilders.terms("favorite_tags")
                        .field("tags.keyword")
                        .size(10))
                .addAggregation(AggregationBuilders.stats("interaction_stats")
                        .field("likesCount"))
                .build();

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        // 处理结果
        Map<String, Object> analysis = new HashMap<>();
        
        // 发帖趋势
        org.elasticsearch.search.aggregations.bucket.histogram.Histogram postingTrend = 
                searchHits.getAggregations().get("posting_trend");
        analysis.put("postingTrend", postingTrend.getBuckets().stream()
                .map(bucket -> Map.of(
                        "date", bucket.getKeyAsString(),
                        "count", bucket.getDocCount()))
                .collect(Collectors.toList()));

        // 常用标签
        Terms favoriteTags = searchHits.getAggregations().get("favorite_tags");
        analysis.put("favoriteTags", favoriteTags.getBuckets().stream()
                .map(bucket -> Map.of(
                        "tag", bucket.getKeyAsString(),
                        "count", bucket.getDocCount()))
                .collect(Collectors.toList()));

        // 互动统计
        org.elasticsearch.search.aggregations.metrics.Stats interactionStats = 
                searchHits.getAggregations().get("interaction_stats");
        analysis.put("interactionStats", Map.of(
                "totalLikes", interactionStats.getSum(),
                "avgLikes", interactionStats.getAvg(),
                "maxLikes", interactionStats.getMax()));

        return analysis;
    }

    @Override
    public List<Map<String, Object>> getContentTrendsAnalysis(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);

        // 构建内容趋势分析查询
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .withQuery(QueryBuilders.rangeQuery("createdAt").gte(startTime))
                .addAggregation(AggregationBuilders.dateHistogram("daily")
                        .field("createdAt")
                        .calendarInterval(DateHistogramInterval.DAY)
                        .subAggregation(AggregationBuilders.terms("topics")
                                .field("tags.keyword")
                                .size(5))
                        .subAggregation(AggregationBuilders.avg("avg_likes")
                                .field("likesCount"))
                        .subAggregation(AggregationBuilders.avg("avg_comments")
                                .field("commentsCount")))
                .build();

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        // 处理结果
        org.elasticsearch.search.aggregations.bucket.histogram.Histogram histogram = 
                searchHits.getAggregations().get("daily");
        
        return histogram.getBuckets().stream()
                .map(bucket -> {
                    Map<String, Object> trend = new HashMap<>();
                    trend.put("date", bucket.getKeyAsString());
                    trend.put("postCount", bucket.getDocCount());
                    
                    // 热门话题
                    Terms topics = bucket.getAggregations().get("topics");
                    trend.put("hotTopics", topics.getBuckets().stream()
                            .map(topicBucket -> Map.of(
                                    "topic", topicBucket.getKeyAsString(),
                                    "count", topicBucket.getDocCount()))
                            .collect(Collectors.toList()));
                    
                    // 平均互动数据
                    trend.put("avgLikes", ((org.elasticsearch.search.aggregations.metrics.Avg) 
                            bucket.getAggregations().get("avg_likes")).getValue());
                    trend.put("avgComments", ((org.elasticsearch.search.aggregations.metrics.Avg)
                            bucket.getAggregations().get("avg_comments")).getValue());
                    
                    return trend;
                })
                .collect(Collectors.toList());
    }

    @Override
    public void rebuildIndex() {
        // 删除现有索引
        elasticsearchRestTemplate.indexOps(PostDocument.class).delete();
        
        // 重新创建索引
        elasticsearchRestTemplate.indexOps(PostDocument.class).create();
        
        // 重新导入所有数据
        // 这里需要分批处理大量数据
        int batchSize = 1000;
        int offset = 0;
        
        while (true) {
            // 从数据库获取一批数据
            // 这里需要注入PostMapper来获取数据
            // List<Post> posts = postMapper.selectPage(new Page<>(offset, batchSize));
            List<Post> posts = new ArrayList<>(); // 临时代码
            
            if (posts.isEmpty()) {
                break;
            }
            
            // 同步到ES
            syncBatchToES(posts);
            
            offset += batchSize;
        }
    }

    @Override
    public List<Map<String, Object>> getKeywordAnalysis(int days, int limit) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);

//        // 构建关键词分析查询
//        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
//                .withQuery(QueryBuilders.rangeQuery("createdAt").gte(startTime))
//                .addAggregation(AggregationBuilders.significant_text("keywords")
//                        .field("content")
//                        .size(limit))
//                .build();

//        // 执行查询
//        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
//                searchQuery,
//                PostDocument.class
//        );

//        // 处理结果
//        org.elasticsearch.search.aggregations.bucket.significant.SignificantTerms significantTerms =
//                searchHits.getAggregations().get("keywords");
//
//        return significantTerms.getBuckets().stream()
//                .map(bucket -> {
//                    Map<String, Object> keyword = new HashMap<>();
//                    keyword.put("term", bucket.getKeyAsString());
//                    keyword.put("score", bucket.getSignificanceScore());
//                    keyword.put("count", bucket.getDocCount());
//                    return keyword;
//                })
//                .collect(Collectors.toList());
        return null;
    }

    @Override
    public Map<String, Object> getQualityDistribution() {
        // 构建质量分布查询
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
                .addAggregation(AggregationBuilders.range("quality_ranges")
                        .field("qualityScore")
                        .addRange("low", 0, 40)
                        .addRange("medium", 40, 70)
                        .addRange("high", 70, 100))
                .build();

        // 执行查询
        SearchHits<PostDocument> searchHits = elasticsearchRestTemplate.search(
                searchQuery,
                PostDocument.class
        );

        // 处理结果
        org.elasticsearch.search.aggregations.bucket.range.Range ranges = 
                searchHits.getAggregations().get("quality_ranges");
        
        Map<String, Object> distribution = new HashMap<>();
        ranges.getBuckets().forEach(bucket ->
                distribution.put(bucket.getKeyAsString(), bucket.getDocCount()));
        
        return distribution;
    }

    // 辅助方法：计算情感词出现次数
    private long countSentimentWords(String content, Set<String> words) {
        return words.stream()
                .filter(word -> content.toLowerCase().contains(word.toLowerCase()))
                .count();
    }

    // 辅助方法：获取积极词典
    private Set<String> getPositiveWords() {
        // 这里应该从配置文件或数据库加载
        return new HashSet<>(Arrays.asList(
                "好", "棒", "赞", "喜欢", "美味", "推荐", "优秀", "满意",
                "开心", "快乐", "惊喜", "完美", "精彩", "享受", "美好"
        ));
    }

    // 辅助方法：获取消极词典
    private Set<String> getNegativeWords() {
        // 这里应该从配置文件或数据库加载
        return new HashSet<>(Arrays.asList(
                "差", "糟", "难吃", "失望", "不好", "垃圾", "坏", "差劲",
                "恶心", "糟糕", "不满", "不推荐", "难受", "讨厌", "烂"
        ));
    }

    // 辅助方法：获取敏感词列表
    private Set<String> getSensitiveWords() {
        // 这里应该从配置文件或数据库加载
        return new HashSet<>(Arrays.asList(
                "敏感词1", "敏感词2", "敏感词3"
        ));
    }
} 