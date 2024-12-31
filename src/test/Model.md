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

功能扩展建议
1. 消息已读/未读状态
   描述: 发送消息时，接收方可以看到消息的已读或未读状态。
   前端改进:
   在消息结构中增加 isRead 字段。
   当消息被接收方的前端加载时，发送一个确认消息到后端，标记消息为已读。
   后端改进:
   在数据库中存储消息的 isRead 状态。
   在接收方确认读取时，更新消息状态为 true。
2. 离线消息推送
   描述: 当接收者离线时，消息存储在数据库中，接收者上线后自动加载未读消息。
   前端改进:
   在用户上线时，加载未读消息并展示。
   后端改进:
   在 WebSocket 的 afterConnectionEstablished 方法中，查询该用户的未读消息并推送。
3. 消息撤回功能
   描述: 用户可以撤回已发送的消息（比如 2 分钟内撤回）。
   前端改进:
   添加 "撤回" 按钮，点击后发送撤回请求到服务器。
   后端改进:
   在数据库中存储消息的撤回状态（如 isRecalled 字段）。
   消息撤回后通知所有相关用户，并在前端移除或标记为“已撤回”。
4. 文件和图片传输
   描述: 支持发送图片、文件等多媒体消息。
   前端改进:
   在消息输入框旁添加文件上传按钮，上传文件后显示文件或图片预览。
   通过 WebSocket 或 REST API 上传文件。
   后端改进:
   使用文件存储服务（如 AWS S3、阿里云 OSS）存储文件。
   返回文件的访问 URL，在聊天记录中显示文件链接或图片。
5. 群聊支持
   描述: 支持多个用户加入同一个群聊房间，消息会广播给群内所有成员。
   前端改进:
   用户选择或创建一个群聊，发送消息时附带 groupId。
   接收到消息时，根据 groupId 区分显示。
   后端改进:
   数据库中增加群组表，记录群组成员。
   WebSocket 服务广播消息时，将消息推送给群组中的所有用户。
6. 在线用户状态
   描述: 显示当前在线用户列表。
   前端改进:
   在界面侧边栏或顶部显示在线用户列表。
   用户上线/下线时，更新列表。
   后端改进:
   使用 ConcurrentHashMap 维护在线用户的 WebSocket 连接。
   每当用户连接或断开时，更新在线状态并广播。
7. 聊天记录分页加载
   描述: 加载历史消息时，支持分页加载（如每次加载 20 条）。
   前端改进:
   在聊天窗口滚动到顶部时触发加载上一页消息。
   后端改进:
   REST API 增加分页参数（如 ?page=1&size=20）。
   查询历史记录时返回指定页数的记录。
8. 搜索聊天记录
   描述: 支持按关键字搜索聊天记录。
   前端改进:
   添加搜索框，用户输入关键字后调用搜索接口，显示结果。
   后端改进:
   在数据库中通过 content 字段进行模糊搜索，返回匹配的消息记录。
9. 消息通知
   描述: 当用户收到新消息时，在浏览器页面或手机上显示通知。
   前端改进:
   使用浏览器的 Notification API 显示消息通知：
   javascript
   复制代码
   if (Notification.permission === "granted") {
   new Notification("New message from user2", { body: "Hello!" });
   }
   如果权限未开启，提示用户启用通知权限。
   后端改进:
   无需额外改动，消息通过 WebSocket 推送后触发前端通知。
10. 消息多端同步
    描述: 用户在不同设备上登录时，消息需要同步。
    实现思路:
    数据库为中心: 所有消息存储在数据库中，前端加载消息时，始终从数据库拉取最新数据。
    消息状态同步: 在前端通过 WebSocket 和 REST API 确保消息状态一致。
11. 消息表情支持
    描述: 支持发送和显示表情符号或自定义表情包。
    前端改进:
    提供表情选择器，选择后将表情代码插入消息内容。
    使用第三方库（如 emoji-picker-element）实现。
    后端改进:
    不需要额外改动，表情符号是 Unicode 字符，可以直接存储和显示。
12. 音视频通话
    描述: 实现音频或视频通话功能。
    前端改进:
    使用 WebRTC 实现音视频通话。
    显示通话按钮，用户点击后建立 WebRTC 连接。
    后端改进:
    使用 WebSocket 进行信令交换，建立 WebRTC 点对点连接。
13. 自定义消息状态
    描述: 为不同消息类型定义状态，例如：
    文本消息：发送中、已发送、已读。
    文件消息：上传中、上传成功、上传失败。
    前端改进:
    在消息列表中添加状态标识（如小图标）。
    消息状态更新后实时刷新界面。
    后端改进:
    增加消息状态字段，例如 status，在消息处理时更新状态。
14. 多语言支持
    描述: 支持国际化，用户可以切换聊天界面的语言。
    前端改进:
    使用 i18next 或其他国际化库管理文本内容。
    用户选择语言后，重新渲染页面。
    后端改进:
    不需要改动，国际化只影响前端显示。
15. 聊天背景自定义
    描述: 用户可以更改聊天背景，选择自己喜欢的颜色或图片。
    前端改进:
    在设置页面添加背景选择器，修改样式：
    css
    复制代码
    .chat-messages {
    background-image: url("custom-background.jpg");
    background-color: #f4f4f4;
    }
    总结
    通过这些功能扩展，你的聊天应用可以更完善，接近商业级聊天产品。优先级建议如下：

核心功能：离线消息、消息已读/未读、分页加载、文件传输。
用户体验：消息撤回、表情支持、消息通知。
高级功能：群聊、音视频通话、多语言支持。
高级功能：群聊、音视频通话、多语言支持。


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



















//    @Autowired
//    private UserService userService;
//
//    @Autowired
//    private AIRecipeService aiRecipeService;
//
//    @Autowired
//    private JwtUtils jwtUtils;
//
//    @GetMapping("/generate-meal-plan")
//    public ApiResponse<String> generateMealPlan(@RequestHeader("Authorization") String token) {
//        try {
//            // Step 1: 获取用户 ID
//            Long userIdFromToken = jwtUtils.getUserIdFromToken(token);
//
//            // Step 2: 查询当前用户的库存
//            List<UserInventory> inventoryList = userInventoryService.getAllByUserId(userIdFromToken);
//            if (inventoryList == null || inventoryList.isEmpty()) {
//                return ApiResponse.error(400, "当前用户没有库存记录");
//            }
//
//            // Step 3: 查询用户的相关信息
//            User user = userService.getUserById(userIdFromToken);
//            if (user == null) {
//                return ApiResponse.error(400, "用户信息不存在");
//            }
//
//            // Step 4: 聚合用户信息并对接 AI 模块生成菜谱
//            String aggregatedInfo = aggregateUserInfo(user, inventoryList);
//            List<String> recipes = aiRecipeService.getRecipesForMeal(aggregatedInfo);
//
//            // Step 5: 验证数据库中是否已有该菜谱记录
//            for (String recipe : recipes) {
//                boolean isRecipeExists = userInventoryService.isRecipeExists(recipe);
//                if (!isRecipeExists) {
//                    // Step 6: 如果没有，调用 AI 模块生成菜谱的图片信息
//                    String recipeImageUrl = aiRecipeService.generateRecipeImage(recipe);
//
//                    // Step 7: 保存新生成的菜谱到数据库
//                    userInventoryService.saveRecipe(recipe, recipeImageUrl);
//                }
//            }
//
//            return ApiResponse.success("今日菜谱生成成功");
//
//        } catch (Exception e) {
//            e.printStackTrace();
//            return ApiResponse.error(500, "系统异常，请稍后再试");
//        }
//    }
