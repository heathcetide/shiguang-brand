package com.foodrecord.common.utils;

import com.foodrecord.model.entity.User;
import org.springframework.web.multipart.MultipartFile;

import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.Reader;
import java.util.ArrayList;
import java.util.List;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVRecord;

public class CsvExportUtil {

    /**
     * 导入csv
     * @param file
     * @return
     * @throws IOException
     */
    public static List<User> readUsersFromCsv(MultipartFile file) throws IOException {
        List<User> users = new ArrayList<>();
        Reader reader = new InputStreamReader(file.getInputStream());
        Iterable<CSVRecord> records = CSVFormat.DEFAULT
                .withHeader("username", "password", "email", "phone", "nickname", "role", "status")
                .withFirstRecordAsHeader()
                .parse(reader);

        for (CSVRecord record : records) {
            User user = new User();
            user.setUsername(record.get("username"));
            user.setPassword(record.get("password")); // 加密处理可在此处进行
            user.setEmail(record.get("email"));
            user.setPhone(record.get("phone"));
            user.setNickname(record.get("nickname"));
            user.setRole(record.get("role"));
            user.setStatus(Integer.parseInt(record.get("status")));
            users.add(user);
        }
        return users;
    }

    /**
     * 将用户列表导出为 CSV 文件
     *
     * @param response HttpServletResponse
     * @param users    用户列表
     */
    public static void exportToCsv(HttpServletResponse response, List<User> users) {
        // 设置响应头信息
        response.setContentType("text/csv");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Content-Disposition", "attachment; filename=users.csv");

        try (PrintWriter writer = response.getWriter()) {
            // 写入 CSV 表头
            writer.println("ID,用户名,密码,邮箱,手机号,昵称,头像URL,性别,生日,状态,角色");

            // 写入用户数据
            for (User user : users) {
                writer.println(String.format("%d,%s,%s,%s,%s,%s,%s,%s,%s,%d,%s",
                        user.getId(),
                        sanitize(user.getUsername()),
                        sanitize(user.getPassword()),
                        sanitize(user.getEmail()),
                        sanitize(user.getPhone()),
                        sanitize(user.getNickname()),
                        sanitize(user.getAvatarUrl()),
                        user.getGender() == null ? "" : (user.getGender() == 0 ? "女" : "男"),
                        user.getBirthday() == null ? "" : user.getBirthday().toString(),
                        user.getStatus(),
                        sanitize(user.getRole())
                ));
            }

            writer.flush();
        } catch (IOException e) {
            throw new RuntimeException("导出 CSV 文件失败", e);
        }
    }

    /**
     * 清理字段内容，防止特殊字符影响 CSV 格式
     *
     * @param value 字段值
     * @return 清理后的字段值
     */
    private static String sanitize(String value) {
        if (value == null) {
            return "";
        }
        return value.replaceAll("\"", "\"\""); // 替换双引号以防止破坏 CSV 格式
    }
}
