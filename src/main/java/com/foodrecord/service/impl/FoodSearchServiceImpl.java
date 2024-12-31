package com.foodrecord.service.impl;


import com.foodrecord.model.entity.Food;
import com.foodrecord.repository.FoodRepository;
import com.foodrecord.service.FoodSearchService;
import org.elasticsearch.index.query.QueryBuilders;
import org.elasticsearch.search.aggregations.AggregationBuilders;
import org.elasticsearch.search.aggregations.Aggregations;
import org.elasticsearch.search.aggregations.bucket.terms.Terms;
import org.elasticsearch.search.fetch.subphase.highlight.HighlightBuilder;
import org.springframework.beans.factory.annotation.Autowired;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.elasticsearch.core.ElasticsearchRestTemplate;
import org.springframework.data.elasticsearch.core.SearchHits;
import org.springframework.data.elasticsearch.core.query.NativeSearchQueryBuilder;
import org.springframework.data.elasticsearch.core.query.Query;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class FoodSearchServiceImpl implements FoodSearchService {

    @Resource
    private ElasticsearchRestTemplate elasticsearchRestTemplate;

    @Autowired
    private FoodRepository foodRepository;

    @Override
    public Page<Food> search(String keyword, Page<Food> page) {
        // 构建查询并添加高亮
        Query query = new NativeSearchQueryBuilder()
                .withQuery(QueryBuilders.multiMatchQuery(keyword, "name", "healthLabel", "suggest"))
                .withHighlightFields(
                        new HighlightBuilder.Field("name").preTags("<em>").postTags("</em>"),
                        new HighlightBuilder.Field("healthLabel").preTags("<em>").postTags("</em>"),
                        new HighlightBuilder.Field("suggest").preTags("<em>").postTags("</em>")
                )
                .withPageable(org.springframework.data.domain.PageRequest.of(
                        (int) (page.getCurrent() - 1), // 分页从 0 开始
                        (int) page.getSize()))
                .build();

        // 执行查询
        SearchHits<Food> searchHits = elasticsearchRestTemplate.search(query, Food.class);

        // 提取查询结果并处理高亮
        List<Food> foodList = searchHits.getSearchHits().stream()
                .map(hit -> {
                    Food food = hit.getContent();

                    // 高亮字段处理
                    if (hit.getHighlightFields().containsKey("name")) {
                        food.setName(hit.getHighlightFields().get("name").get(0));
                    }
                    if (hit.getHighlightFields().containsKey("healthLabel")) {
                        food.setHealthLabel(hit.getHighlightFields().get("healthLabel").get(0));
                    }
                    if (hit.getHighlightFields().containsKey("suggest")) {
                        food.setSuggest(hit.getHighlightFields().get("suggest").get(0));
                    }

                    return food;
                })
                .collect(Collectors.toList());

        // 设置分页结果
        page.setRecords(foodList);
        page.setTotal(searchHits.getTotalHits());

        return page;
    }

    @Override
    public Map<String, Long> aggregateByHealthLight() {
        Query query = new NativeSearchQueryBuilder()
                .addAggregation(AggregationBuilders.terms("healthLightAgg").field("healthLight"))
                .build();

        // 执行聚合查询
        Aggregations aggregations = elasticsearchRestTemplate.search(query, Food.class).getAggregations();

        // 提取结果
        Terms healthLightTerms = aggregations.get("healthLightAgg");
        Map<String, Long> result = new HashMap<>();
        for (Terms.Bucket bucket : healthLightTerms.getBuckets()) {
            result.put(bucket.getKeyAsString(), bucket.getDocCount());
        }
        return result;
    }

    @Override
    public List<String> suggest(String prefix) {
        // 构建补全查询
        Query query = new NativeSearchQueryBuilder()
                .withQuery(QueryBuilders.matchPhrasePrefixQuery("prompt", prefix)) // 匹配 prompt 字段的前缀
                .withPageable(org.springframework.data.domain.PageRequest.of(0, 10)) // 限制返回条数
                .build();

        // 执行查询
        SearchHits<Food> searchHits = elasticsearchRestTemplate.search(query, Food.class);

        // 提取补全结果
        return searchHits.getSearchHits().stream()
                .map(hit -> hit.getContent().getName()) // 返回 name 作为补全的关键词
                .distinct()
                .collect(Collectors.toList());
    }

//    功能 2：范围查询
//            场景
//    比如筛选一定时间范围内的 createdAt 数据。
//    public Page<Food> searchByDateRange(LocalDateTime startDate, LocalDateTime endDate, Page<Food> page) {
//        Query query = new NativeSearchQueryBuilder()
//                .withQuery(QueryBuilders.boolQuery()
//                        .must(QueryBuilders.rangeQuery("createdAt")
//                                .gte(startDate.toString()) // 开始时间
//                                .lte(endDate.toString())  // 结束时间
//                        ))
//                .withPageable(org.springframework.data.domain.PageRequest.of((int) page.getCurrent() - 1, (int) page.getSize()))
//                .build();
//
//        SearchHits<Food> searchHits = elasticsearchRestTemplate.search(query, Food.class);
//
//        List<Food> foodList = searchHits.getSearchHits().stream()
//                .map(SearchHit::getContent)
//                .toList();
//
//        return new org.springframework.data.domain.PageImpl<>(foodList, org.springframework.data.domain.PageRequest.of((int) page.getCurrent() - 1, (int) page.getSize()), searchHits.getTotalHits());
//    }

    //功能 3：地理位置查询
    //场景
    //如果你的 Food 数据有地理位置字段（比如 latitude 和 longitude），可以实现按地理范围或距离过滤。
    //
    //示例：按距离查询
    //public Page<Food> searchByLocation(double latitude, double longitude, double distanceKm, Page<Food> page) {
    //    Query query = new NativeSearchQueryBuilder()
    //            .withQuery(QueryBuilders.geoDistanceQuery("location")
    //                    .point(latitude, longitude)
    //                    .distance(distanceKm, DistanceUnit.KILOMETERS))
    //            .withPageable(org.springframework.data.domain.PageRequest.of((int) page.getCurrent() - 1, (int) page.getSize()))
    //            .build();
    //
    //    SearchHits<Food> searchHits = elasticsearchRestTemplate.search(query, Food.class);
    //
    //    List<Food> foodList = searchHits.getSearchHits().stream()
    //            .map(SearchHit::getContent)
    //            .toList();
    //
    //    return new org.springframework.data.domain.PageImpl<>(foodList, org.springframework.data.domain.PageRequest.of((int) page.getCurrent() - 1, (int) page.getSize()), searchHits.getTotalHits());
    //}
}