package com.foodrecord.task;

import cn.hutool.http.HttpRequest;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.foodrecord.model.entity.Post;
import com.foodrecord.service.PostService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

@Component
public class GrabData {

    @Autowired
    private PostService postService;

    @Scheduled(cron = "0/5 * * * * ?")
//    @Scheduled(cron = "0 0 1 * * ?")
    public void executeTask() {
        //1.获取数据
        String json = "{\n" +
                "  \"current\": 1,\n" +
                "  \"pageSize\": 20,\n" +
                "  \"sortField\": \"createTime\",\n" +
                "  \"sortOrder\": \"descend\",\n" +
                "  \"category\": \"文章\",\n" +
                "  \"tags\": [],\n" +
                "  \"reviewStatus\": 1\n" +
                "}";
        String url = "https://api.code-nav.cn/api/post/search/page/vo";
        String result2 = HttpRequest.post(url)
                .body(json)
                .execute().body();
        //2.JSON转对象
        Map<String, Object> map = JSONUtil.toBean(result2, Map.class);
        JSONObject data = (JSONObject) map.get("data");
        JSONArray records = (JSONArray) data.get("records");
        List<Post> postList = new ArrayList<>();
        for (Object record : records) {
            JSONObject tmpObject = (JSONObject) record;
            Post post = new Post();
            //post.setTitle(tmpObject.getStr("title"));
            post.setContent(tmpObject.getStr("content"));
            JSONArray tags = (JSONArray) tmpObject.get("tags");
            List<String> list = tags.toList(String.class);
            post.setTags(JSONUtil.toJsonStr(list));
            post.setCreatedAt(new Date());
            post.setUpdatedAt(new Date());
            postList.add(post);
        }
        postService.saveAll(postList);
        System.out.println(result2);
    }
}