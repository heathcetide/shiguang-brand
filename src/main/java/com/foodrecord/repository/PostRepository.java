package com.foodrecord.repository;

import com.foodrecord.model.es.PostDocument;
import org.springframework.data.elasticsearch.repository.ElasticsearchRepository;

public interface PostRepository extends ElasticsearchRepository<PostDocument, Long> {
} 