com.foodrecord
├── ml                              # 核心模块：机器学习部分
│   ├── config                      # 配置模块
│   │   ├── MLConfig.java           # 深度学习模型的基础配置（如MultiLayerNetwork等）
│   │   ├── MLDatabaseConfig.java   # 数据库相关配置，包括SqlSessionFactory
│   │   ├── ModelConfig.java        # 模型的超参数配置（如学习率、批量大小、隐藏层等）
│   ├── data                        # 数据处理模块
│   │   ├── DataPreprocessor.java   # 数据预处理类，生成训练数据集、归一化等
│   │   └── MLDataSet.java          # 数据集类，用于封装特征和标签
│   ├── evaluation                  # 模型评估模块
│   │   └── ModelEvaluator.java     # 模型评估类，计算RMSE、MAE等指标
│   ├── feature                     # 特征工程模块
│   │   ├── FeatureExtractor.java   # 提取用户和食物特征
│   │   ├── AdvancedFeatureEngineering.java # 高级特征工程（如时间序列、健康特征等）
│   │   └── FeatureEngineering.java # 通用特征工程
│   ├── model                       # 模型模块
│   │   ├── CollaborativeFilteringModel.java # 协同过滤模型
│   │   ├── FoodRecommenderModel.java # 食物推荐模型（基于深度学习）
│   │   ├── HybridRecommenderModel.java # 混合推荐模型，结合深度学习和协同过滤
│   │   └── MultiHeadAttentionLayer.java # 自定义多头注意力机制
│   ├── monitor                     # 训练监控模块
│   │   └── TrainingMonitor.java    # 模型训练过程的日志与监控
│   ├── service                     # 服务模块
│   │   ├── RecommenderService.java # 推荐系统服务接口
│   │   └── impl
│   │       └── RecommenderServiceImpl.java # 推荐系统服务实现类
│   └── util                        # 工具模块
│       └── MLUtils.java            # 常用工具类，如向量归一化、相似度计算
├── entity                          # 实体模块
│   ├── UserFoodInteraction.java    # 用户-食物交互记录实体类
│   ├── UserFeature.java            # 用户特征类
│   └── FoodFeature.java            # 食物特征类
├── mapper                          # 数据访问层（DAO）
│   └── RecommenderMapper.java      # MyBatis接口，用于查询用户和食物交互数据
└── resources                       # 资源文件
├── application.yml             # Spring Boot的配置文件
└── model/                      # 预训练模型的存储路径




各模块功能说明
1. config
   MLConfig.java
   配置和初始化深度学习相关模型（如 MultiLayerNetwork）。
   MLDatabaseConfig.java
   配置数据库连接和 MyBatis 的 SqlSessionFactory。
   ModelConfig.java
   定义模型的超参数（如学习率、批量大小、隐藏层结构等），支持从 application.yml 文件加载。
2. data
   DataPreprocessor.java
   用于数据预处理，包括提取特征矩阵、归一化、拆分训练集和验证集等。
   从数据库中获取用户和食物的交互记录，构建 INDArray 数据集。
   MLDataSet.java
   封装特征和标签矩阵。
   提供数据集拆分方法（训练集/验证集）。
3. evaluation
   ModelEvaluator.java
   提供模型评估方法，包括计算 RMSE、MAE 和 R² 指标，用于验证模型的性能。
4. feature
   FeatureExtractor.java
   提取用户和食物的基础特征。
   使用 UserFeature 和 FoodFeature 类封装特征数据。
   AdvancedFeatureEngineering.java
   提供高级特征工程方法，例如时间序列特征、用户行为模式、健康特征等。
   通过用户健康档案（UserHealthProfile）和食物营养信息生成更丰富的特征。
   FeatureEngineering.java
   提供通用的特征工程方法，例如时间特征、历史行为特征等。
5. model
   CollaborativeFilteringModel.java
   实现协同过滤推荐算法，使用因子分解矩阵完成模型训练和预测。
   FoodRecommenderModel.java
   基于深度学习实现的推荐模型。
   支持模型的训练、预测、保存与加载。
   HybridRecommenderModel.java
   混合推荐模型，结合协同过滤和深度学习模型，进行加权预测。
   MultiHeadAttentionLayer.java
   自定义实现的多头注意力机制，作为深度学习模型的一部分。
6. monitor
   TrainingMonitor.java
   监控模型的训练过程，记录每个 epoch 的损失值和耗时，方便后续分析。
7. service
   RecommenderService.java
   定义推荐系统的服务接口，包括模型训练、推荐结果生成、评分预测等方法。
   RecommenderServiceImpl.java
   实现推荐系统的核心逻辑：
   数据预处理和归一化。
   模型训练和验证。
   为用户生成推荐结果。
8. util
   MLUtils.java
   提供工具类方法，例如向量归一化、向量相似度计算等。
9. entity
   UserFoodInteraction.java
   定义用户与食物交互记录的实体类，包括用户ID、食物ID、评分等。
   UserFeature.java
   定义用户特征类，包括年龄、性别、BMI、健康状态等。
   FoodFeature.java
   定义食物特征类，包括卡路里、营养成分、健康标签等。
10. mapper
    RecommenderMapper.java
    使用 MyBatis 查询数据库的用户-食物交互记录、用户历史行为和食物特征。
11. resources
    application.yml
    配置文件，定义数据库连接信息、模型超参数等。
    model/
    存储训练好的模型文件，以便加载和重新使用。