package com.foodrecord.util;//package com.foodrecord.utils;
//
//import com.foodrecord.common.utils.BaiduUtil;
//import org.json.JSONObject;
//import org.junit.jupiter.api.Test;
//
//import java.io.File;
//import java.math.BigDecimal;
//import java.util.Map;
//
//import static org.junit.jupiter.api.Assertions.*;
//
//public class BaiduUtilTest {
//
//    // 测试图片路径
//    private static final String TEST_IMAGE_PATH = "E:/360Downloads文件下载/1420bc99e7c853b4dd3a18a1cd715129.jpeg";
//    private static final String TEST_LATITUDE = "121.48916145987755";
//    private static final String TEST_LONGITUDE = "31.405486629212866";
//    private static final String BAIDU_API_KEY = "DPinK7BkM3yI4Qptnr0eFZNH"; // 替换为真实的 API Key
//    private static final String BAIDU_SECRET_KEY = "wmZbglKccAGMBwzZCyn9IVQfK2ObRAtc"; // 替换为真实的 Secret Key
//
//    @Test
//    public void testGetCityByLonLat() {
//        Map<String, String> result = BaiduUtil.getCityByLonLat(BAIDU_API_KEY, TEST_LONGITUDE, TEST_LATITUDE);
//        assertNotNull(result, "结果不能为空");
//        System.out.println("城市信息：" + result);
//        assertTrue(result.containsKey("province"), "返回结果中应包含省份信息");
//        assertTrue(result.containsKey("city"), "返回结果中应包含城市信息");
//        assertTrue(result.containsKey("district"), "返回结果中应包含区县信息");
//    }
//
//    @Test
//    public void testGetAuthToken() {
//        String authToken = BaiduUtil.getAuth(BAIDU_API_KEY, BAIDU_SECRET_KEY);
//        assertNotNull(authToken, "Token 不应为空");
//        System.out.println("获取到的 Token：" + authToken);
//    }
//
//    @Test
//    public void testGeneralString() {
//        // 检查文件是否存在
//        File imageFile = new File(TEST_IMAGE_PATH);
//        assertTrue(imageFile.exists(), "测试图片文件不存在，请检查路径：" + TEST_IMAGE_PATH);
//        // 调用识别方法
//        String result = BaiduUtil.generalString(TEST_IMAGE_PATH, true);
//        // 断言结果不为空
//        assertNotNull(result, "识别结果不应为空");
//        assertFalse(result.trim().isEmpty(), "识别结果内容不应为空");
//        // 输出识别结果
//        System.out.println("识别的文字内容：\n" + result);
//    }
//    @Test
//    public void testAnimalDetect() {
//        JSONObject result = BaiduUtil.animalDetect(TEST_IMAGE_PATH);
//        assertNotNull(result, "动物识别结果不应为空");
//        System.out.println("动物识别结果：" + result.toString(2));
//    }
//    @Test
//    public void testDishDetect() {
//        File imageFile = new File("C:/Users/Lenovo/Pictures/64ec328886c2a_800.jpg");
//        assertTrue(imageFile.exists(), "测试图片文件不存在，请检查路径：" + "C:/Users/Lenovo/Pictures/64ec328886c2a_800.jpg");
//        JSONObject result = BaiduUtil.dishDetect("C:/Users/Lenovo/Pictures/64ec328886c2a_800.jpg");
//        assertNotNull(result, "菜品识别结果不应为空");
//        System.out.println("菜品识别结果：" + result.toString(2));
//    }
//    @Test
//    public void testPlantDetect() {
//        JSONObject result = BaiduUtil.plantDetect(TEST_IMAGE_PATH);
//        assertNotNull(result, "植物识别结果不应为空");
//        System.out.println("植物识别结果：" + result.toString(2));
//    }
//    @Test
//    public void testAdvancedGeneral() {
//        JSONObject result = BaiduUtil.advancedGeneral(TEST_IMAGE_PATH);
//        assertNotNull(result, "通用物体识别结果不应为空");
//        System.out.println("通用物体识别结果：" + result.toString(2));
//    }
//    @Test
//    public void testCarDetect() {
//        JSONObject result = BaiduUtil.carDetect(TEST_IMAGE_PATH);
//        assertNotNull(result, "车辆识别结果不应为空");
//        System.out.println("车辆识别结果：" + result.toString(2));
//    }
//}
