package com.foodrecord.config;

import com.foodrecord.model.es.PostDocument;
import org.elasticsearch.client.RestHighLevelClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.elasticsearch.client.ClientConfiguration;
import org.springframework.data.elasticsearch.client.RestClients;
import org.springframework.data.elasticsearch.core.ElasticsearchRestTemplate;
import org.springframework.data.elasticsearch.core.ElasticsearchTemplate;
import org.springframework.data.elasticsearch.repository.config.EnableElasticsearchRepositories;
import org.springframework.data.elasticsearch.core.document.Document;

import javax.annotation.PostConstruct;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;

@Configuration
@EnableElasticsearchRepositories(basePackages = "com.foodrecord.mapper")
public class ElasticsearchConfig {

    @Value("${spring.elasticsearch.rest.uris}")
    private String elasticsearchUri;

    @Value("${spring.elasticsearch.rest.connection-timeout:5000}")
    private long connectionTimeout;

    @Value("${spring.elasticsearch.rest.read-timeout:30000}")
    private long readTimeout;

    @Bean
    public RestHighLevelClient elasticsearchClient() {
        ClientConfiguration clientConfiguration = ClientConfiguration.builder()
                .connectedTo(elasticsearchUri)
                .withConnectTimeout(connectionTimeout)
                .withSocketTimeout(readTimeout)
                .build();
        return RestClients.create(clientConfiguration).rest();
    }

    @Bean
    @Primary
    public ElasticsearchRestTemplate elasticsearchRestTemplate(RestHighLevelClient client) {
        return new ElasticsearchRestTemplate(client);
    }

    @Bean(name = "elasticsearchTemplate")
    public ElasticsearchRestTemplate elasticsearchTemplate(RestHighLevelClient client) {
        return new ElasticsearchRestTemplate(client);
    }

    @PostConstruct
    public void initIndex() {
        try {
            // 读取映射文件
            ClassPathResource resource = new ClassPathResource("es/post-mapping.json");
            String mappingJson = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

            // 获取ES模板
            ElasticsearchRestTemplate template = elasticsearchTemplate(elasticsearchClient());
            
            // 获取索引名称
            String indexName = PostDocument.class.getAnnotation(org.springframework.data.elasticsearch.annotations.Document.class).indexName();
            IndexCoordinates indexCoordinates = IndexCoordinates.of(indexName);

            // 如果索引不存在，则创建
            if (!template.indexOps(PostDocument.class).exists()) {
                template.indexOps(PostDocument.class).create();
                // 使用Document.parse将JSON字符串转换为Document对象
                Document mapping = Document.parse(mappingJson);
                template.indexOps(indexCoordinates).putMapping(mapping);
            }
        } catch (IOException e) {
            // 记录错误但允许应用继续启动
            e.printStackTrace();
        }
    }
} 