package com.foodrecord.service.impl;

import cn.hutool.core.io.resource.ClassPathResource;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.exception.CustomException;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.UserFeedbackMapper;
import com.foodrecord.model.dto.FeedbackQueryDTO;
import com.foodrecord.model.dto.UserFeedbackDTO;
import com.foodrecord.model.entity.SentimentAnalyzer;
import com.foodrecord.model.entity.UserFeedback;
import com.foodrecord.model.vo.SentimentAnalysisResult;
import com.foodrecord.service.UserFeedbackService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.io.File;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class UserFeedbackServiceImpl extends ServiceImpl<UserFeedbackMapper, UserFeedback> implements UserFeedbackService {

    @Resource
    private UserFeedbackMapper feedbackMapper;

    @Resource
    private RedisUtils redisUtils;
    
    private static final String FEEDBACK_CACHE_KEY = "feedback:food:";
    private static final String AVG_RATING_CACHE_KEY = "avg_rating:food:";
    private static final long CACHE_TIME = 3600; // 1小时

    public IPage<UserFeedback> getPageByFoodId(Long foodId, int page, int size) {
        return feedbackMapper.selectPageByFoodId(new Page<>(page, size), foodId);
    }

    public List<UserFeedback> getByFoodId(Long foodId) {
        String key = FEEDBACK_CACHE_KEY + foodId;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (List<UserFeedback>) cached;
        }
        
        List<UserFeedback> feedbacks = feedbackMapper.selectByFoodId(foodId);
        redisUtils.set(key, feedbacks, CACHE_TIME);
        return feedbacks;
    }

    public List<UserFeedback> getByUserId(Long userId) {
        return feedbackMapper.selectByUserId(userId);
    }

    public Double getAvgRatingByFoodId(Long foodId) {
        String key = AVG_RATING_CACHE_KEY + foodId;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (Double) cached;
        }
        
        Double avgRating = feedbackMapper.selectAvgRatingByFoodId(foodId);
        if (avgRating != null) {
            redisUtils.set(key, avgRating, CACHE_TIME);
        }
        return avgRating;
    }

    @Transactional
    public UserFeedback createFeedback(Long userId, UserFeedbackDTO dto) {
        UserFeedback feedback = new UserFeedback();
        feedback.setUserId(userId);
        feedback.setFoodId(dto.getFoodId());
        feedback.setRating(dto.getRating());
        feedback.setComment(dto.getComment());
        
        save(feedback);
        
        // 清除相关缓存
        redisUtils.delete(FEEDBACK_CACHE_KEY + dto.getFoodId());
        redisUtils.delete(AVG_RATING_CACHE_KEY + dto.getFoodId());
        
        return feedback;
    }

    @Transactional
    public UserFeedback updateFeedback(Long userId, Long feedbackId, UserFeedbackDTO dto) {
        UserFeedback feedback = getById(feedbackId);
        if (feedback == null) {
            throw new CustomException("反馈不存在");
        }
        if (!feedback.getUserId().equals(userId)) {
            throw new CustomException("无权修改此反馈");
        }

        feedback.setRating(dto.getRating());
        feedback.setComment(dto.getComment());
        
        updateById(feedback);
        
        // 清除相关缓存
        redisUtils.delete(FEEDBACK_CACHE_KEY + feedback.getFoodId());
        redisUtils.delete(AVG_RATING_CACHE_KEY + feedback.getFoodId());
        
        return feedback;
    }

    @Transactional
    public void deleteFeedback(Long userId, Long feedbackId) {
        UserFeedback feedback = getById(feedbackId);
        if (feedback == null) {
            throw new CustomException("反馈不存在");
        }
        if (!feedback.getUserId().equals(userId)) {
            throw new CustomException("无权删除此反馈");
        }

        removeById(feedbackId);
        
        // 清除相关缓存
        redisUtils.delete(FEEDBACK_CACHE_KEY + feedback.getFoodId());
        redisUtils.delete(AVG_RATING_CACHE_KEY + feedback.getFoodId());
    }

    @Transactional
    public void deleteFeedbackById(Long feedbackId) {
        UserFeedback feedback = getById(feedbackId);
        if (feedback == null) {
            throw new CustomException("反馈不存在");
        }
        removeById(feedbackId);
        // 清除相关缓存
        redisUtils.delete(FEEDBACK_CACHE_KEY + feedback.getFoodId());
        redisUtils.delete(AVG_RATING_CACHE_KEY + feedback.getFoodId());
    }

    @Override
    public IPage<UserFeedback> getAllFeedbacks(int page, int size) {
        return page(new Page<>(page, size));
    }

    @Override
    public void deleteFeedbacksBatch(List<Long> feedbackIds) {
        if (feedbackIds != null && !feedbackIds.isEmpty()) {
            removeByIds(feedbackIds);
        }
    }


    @Override
    public IPage<UserFeedback> queryFeedbacks(FeedbackQueryDTO queryDTO) {
        // Example query logic using MyBatis Plus QueryWrapper or custom SQL in Mapper
        return baseMapper.queryFeedbacks(queryDTO, new Page<>(queryDTO.getPage(), queryDTO.getSize()));
    }

    @Override
    public void updateFeedbackStatus(Long feedbackId, String status) {
        UserFeedback feedback = getById(feedbackId);
        if (feedback != null) {
            feedback.setStatus(status);
            updateById(feedback);
        }
    }

    @Override
    public Map<String, Object> getFeedbackStats() {
        // Example: calculate average rating, feedback count, etc.
        Map<String, Object> stats = new HashMap<>();
        stats.put("averageRating", baseMapper.getAverageRating());
        stats.put("feedbackCount", count());
        return stats;
    }

    @Override
    @Transactional
    public SentimentAnalysisResult analyzeFeedbackSentiment() {
        // 使用 Spring 提供的 ClassPathResource 加载模型文件
        ClassPathResource resource = new ClassPathResource("models/sentiment-model.bin");

        // 获取文件路径或直接读取流
        File modelFile = resource.getFile();  // 如果需要 File 对象
        String modelPath = modelFile.getAbsolutePath();
        try {
            SentimentAnalyzer analyzer = new SentimentAnalyzer(modelPath);

            List<UserFeedback> feedbackList = baseMapper.findList();

            Map<String, Long> sentimentStats = new HashMap<>();
            sentimentStats.put("positive", 0L);
            sentimentStats.put("neutral", 0L);
            sentimentStats.put("negative", 0L);

            for (UserFeedback feedback : feedbackList) {
                String sentiment = analyzer.analyzeSentiment(feedback.getComment());
                // 确保情感分类结果有效
                if (sentimentStats.containsKey(sentiment)) {
                    sentimentStats.put(sentiment, sentimentStats.get(sentiment) + 1);
                } else {
                    // 如果出现未预期的分类，可以选择忽略或记录
                    // 例如：sentimentStats.put(sentiment, 1L);
                }
            }

            // 生成总结
            String summary = generateSummary(sentimentStats);

            return new SentimentAnalysisResult(sentimentStats, summary);
        } catch (Exception e) {
            e.printStackTrace();
            // 可以选择抛出自定义异常或返回一个包含错误信息的对象
            return null;
        }
    }

    @Override
    public Page<UserFeedback> getFeedbacks(Page<UserFeedback> objectPage, String keyword) {
        return feedbackMapper.selectUserFeedbacks(objectPage, keyword);
    }

    /**
     * 根据情感统计生成动态总结
     */
    private String generateSummary(Map<String, Long> sentimentStats) {
        long positive = sentimentStats.getOrDefault("positive", 0L);
        long neutral = sentimentStats.getOrDefault("neutral", 0L);
        long negative = sentimentStats.getOrDefault("negative", 0L);
        long total = positive + neutral + negative;

        if (total == 0) {
            return "暂无用户反馈。";
        }

        double positiveRatio = (double) positive / total * 100;
        double neutralRatio = (double) neutral / total * 100;
        double negativeRatio = (double) negative / total * 100;

        String summary;

        // 根据情感比例进行判断
        if (positiveRatio > 60) {
            summary = getRandomTemplate(positiveTemplates)
                    .replace("%positiveRatio%", String.format("%.1f", positiveRatio))
                    .replace("%positiveCount%", String.valueOf(positive));
        } else if (positiveRatio > neutralRatio && positiveRatio > negativeRatio) {
            summary = getRandomTemplate(positiveTemplates)
                    .replace("%positiveRatio%", String.format("%.1f", positiveRatio))
                    .replace("%positiveCount%", String.valueOf(positive));
        } else if (neutralRatio > positiveRatio && neutralRatio > negativeRatio) {
            summary = getRandomTemplate(neutralTemplates)
                    .replace("%neutralRatio%", String.format("%.1f", neutralRatio))
                    .replace("%neutralCount%", String.valueOf(neutral));
        } else if (negativeRatio > positiveRatio && negativeRatio > neutralRatio) {
            summary = getRandomTemplate(negativeTemplates)
                    .replace("%negativeRatio%", String.format("%.1f", negativeRatio))
                    .replace("%negativeCount%", String.valueOf(negative));
        } else {
            summary = getRandomTemplate(mixedTemplates);
        }

        // 根据总反馈数量添加补充信息
        if (total > 50) {
            summary += " 反馈量较大，共有 " + total + " 条反馈，反映出用户对我们产品/服务的广泛关注。";
        } else if (total > 20) {
            summary += " 反馈量适中，共有 " + total + " 条反馈，显示出用户对我们产品/服务的积极参与。";
        } else {
            summary += " 反馈量较少，共有 " + total + " 条反馈，建议收集更多用户意见以获取更全面的反馈。";
        }

        return summary;
    }


    /**
     * 随机选择一个模板
     */
    private String getRandomTemplate(String[] templates) {
        int index = (int) (Math.random() * templates.length);
        return templates[index];
    }


    private String[] positiveTemplates = {
            "用户反馈积极，表明大家对我们的产品/服务非常满意。",
            "正面反馈占多数，显示出用户对我们的产品/服务高度认可。",
            "大多数反馈为正面，用户对我们的产品/服务持肯定态度。",
            "用户大多表达了积极的情感，显示出高满意度。",
            "反馈显示出强烈的正面情绪，用户对我们的产品/服务非常满意。",
            "用户普遍给予正面评价，反映出产品/服务质量优异。",
            "大量正面反馈表明用户对我们的产品/服务非常认可。",
            "用户的积极反馈展示了我们产品/服务的卓越表现。",
            "正面情绪占据主导，用户对我们的产品/服务感到满意。",
            "用户反馈充满正能量，体现了对产品/服务的高度满意。"
    };

    private String[] neutralTemplates = {
            "反馈情绪中等，用户对我们的产品/服务持中立态度。",
            "中性反馈占比高，显示出用户对我们的产品/服务态度较为平衡。",
            "用户反馈中性，既有肯定也有保留意见。",
            "反馈情绪较为中立，用户对产品/服务保持平衡态度。",
            "中性情感占主导，用户对我们的产品/服务态度较为平和。",
            "用户反馈显示出中性的情绪，表明对产品/服务有客观评价。",
            "中立反馈较多，用户对我们的产品/服务持中立立场。",
            "用户的中性反馈反映了对产品/服务的客观看法。",
            "反馈情感平衡，用户对产品/服务既有认可也有建议。",
            "中性评价占据主要部分，显示出用户对产品/服务的综合态度。"
    };


    private String[] negativeTemplates = {
            "部分反馈为负面，用户对我们的产品/服务存在不满。",
            "负面反馈比例较高，需关注用户的不满点并及时改进。",
            "用户反馈中存在一定的负面情绪，建议深入分析具体原因。",
            "负面情感占主导，用户对我们的产品/服务存在较多不满。",
            "反馈显示出明显的负面情绪，需立即采取措施改进。",
            "用户的负面评价指出了我们产品/服务中的不足之处。",
            "负面反馈较多，反映出用户对产品/服务有不满之处。",
            "用户表达了负面情绪，需针对性地进行改进。",
            "部分用户对我们的产品/服务提出了批评意见，需重视并改进。",
            "负面评价显示出用户对产品/服务存在一定的失望。"
    };


    private String[] mixedTemplates = {
            "用户反馈情绪较为混杂，需进一步分析具体原因。",
            "反馈中正面、中性和负面情感都有涉及，建议深入挖掘具体反馈内容。",
            "情感分布较为均衡，用户对我们的产品/服务既有肯定也有批评。",
            "反馈情绪多样，显示出用户对产品/服务有多方面的看法。",
            "用户反馈表现出多样化的情感，需综合考虑各方面意见。",
            "反馈中既有积极评价，也有建设性的批评，需综合分析。",
            "用户的反馈情绪丰富，反映出多元化的意见和建议。",
            "情感反馈不一，表明用户对产品/服务有多种体验。",
            "用户反馈涵盖正面、中性和负面情绪，需全面审视。",
            "反馈情绪多样化，显示出用户对产品/服务有不同的感受。"
    };


} 