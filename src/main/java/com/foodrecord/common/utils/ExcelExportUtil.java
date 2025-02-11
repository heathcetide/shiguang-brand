package com.foodrecord.common.utils;

import com.foodrecord.model.entity.User;
import com.foodrecord.model.entity.UserFeedback;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.web.multipart.MultipartFile;

import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class ExcelExportUtil {

    /**
     * 导入EXCEL文件
     * @param file
     * @return
     * @throws IOException
     */
    public static List<User> readUsersFromExcel(MultipartFile file) throws IOException {
        List<User> users = new ArrayList<>();
        Workbook workbook = WorkbookFactory.create(file.getInputStream());
        Sheet sheet = workbook.getSheetAt(0);

        // 假设第一行为表头，从第二行开始读取数据
        for (int i = 1; i <= sheet.getLastRowNum(); i++) {
            Row row = sheet.getRow(i);
            if (row == null) continue;

            User user = new User();
            user.setUsername(getCellValue(row.getCell(0)));
            user.setPassword(getCellValue(row.getCell(1))); // 加密处理可在此处进行
            user.setEmail(getCellValue(row.getCell(2)));
            user.setPhone(getCellValue(row.getCell(3)));
            user.setNickname(getCellValue(row.getCell(4)));
            user.setRole(getCellValue(row.getCell(5)));
            user.setStatus(Integer.parseInt(getCellValue(row.getCell(6))));
            users.add(user);
        }
        workbook.close();
        return users;
    }

    private static String getCellValue(Cell cell) {
        if (cell == null) return "";
        switch (cell.getCellType()) {
            case STRING:
                return cell.getStringCellValue();
            case NUMERIC:
                return String.valueOf((int) cell.getNumericCellValue());
            case BOOLEAN:
                return String.valueOf(cell.getBooleanCellValue());
            default:
                return "";
        }
    }

    /**
     * 导出用户数据为 Excel 文件
     *
     * @param response HttpServletResponse
     * @param users    用户列表
     */
    public static void exportToExcel(HttpServletResponse response, List<User> users) {
        // 创建工作簿和工作表
        Workbook workbook = new XSSFWorkbook();
        Sheet sheet = workbook.createSheet("用户数据");

        // 创建表头行
        Row headerRow = sheet.createRow(0);
        String[] headers = {"ID", "用户名", "密码", "邮箱", "手机号", "昵称", "头像URL", "性别", "生日", "状态", "角色"};
        for (int i = 0; i < headers.length; i++) {
            Cell cell = headerRow.createCell(i);
            cell.setCellValue(headers[i]);
        }

        // 填充数据
        int rowNum = 1;
        for (User user : users) {
            Row row = sheet.createRow(rowNum++);
            row.createCell(0).setCellValue(user.getId());
            row.createCell(1).setCellValue(user.getUsername());
            row.createCell(2).setCellValue(user.getPassword());
            row.createCell(3).setCellValue(user.getEmail());
            row.createCell(4).setCellValue(user.getPhone());
            row.createCell(5).setCellValue(user.getNickname());
            row.createCell(6).setCellValue(user.getAvatarUrl());
            row.createCell(7).setCellValue(user.getGender() == null ? "" : (user.getGender() == 0 ? "女" : "男"));
            row.createCell(8).setCellValue(user.getBirthday() == null ? "" : user.getBirthday().toString());
            row.createCell(9).setCellValue(user.getStatus());
            row.createCell(10).setCellValue(user.getRole());
        }

        // 设置响应头
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename=users.xlsx");

        // 将工作簿写入响应输出流
        try {
            workbook.write(response.getOutputStream());
        } catch (IOException e) {
            throw new RuntimeException("导出 Excel 文件失败", e);
        } finally {
            try {
                workbook.close();
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }

    /**
     * 导出用户反馈数据为 Excel 文件
     *
     * @param response     HttpServletResponse
     * @param feedbackList 用户反馈列表
     */
    public static void exportFeedbackToExcel(HttpServletResponse response, List<UserFeedback> feedbackList) {
        // 创建工作簿和工作表
        Workbook workbook = new XSSFWorkbook();
        Sheet sheet = workbook.createSheet("用户反馈数据");

        // 创建表头行
        Row headerRow = sheet.createRow(0);
        String[] headers = {"反馈ID", "用户ID", "食物ID", "评分", "评论", "状态", "用户名", "食物名称"};
        for (int i = 0; i < headers.length; i++) {
            Cell cell = headerRow.createCell(i);
            cell.setCellValue(headers[i]);
        }

        // 填充数据
        int rowNum = 1;
        for (UserFeedback feedback : feedbackList) {
            Row row = sheet.createRow(rowNum++);
            row.createCell(0).setCellValue(feedback.getId());
            row.createCell(1).setCellValue(feedback.getUserId());
            row.createCell(2).setCellValue(feedback.getFoodId());
            row.createCell(3).setCellValue(feedback.getRating());
            row.createCell(4).setCellValue(feedback.getComment() == null ? "" : feedback.getComment());
            row.createCell(5).setCellValue(feedback.getStatus() == null ? "" : feedback.getStatus());
            row.createCell(6).setCellValue(feedback.getUser() == null ? "" : feedback.getUser().getUsername());
            row.createCell(7).setCellValue(feedback.getFood() == null ? "" : feedback.getFood().getName());
        }

        // 设置响应头
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename=user_feedback.xlsx");

        // 将工作簿写入响应输出流
        try {
            workbook.write(response.getOutputStream());
        } catch (IOException e) {
            throw new RuntimeException("导出 Excel 文件失败", e);
        } finally {
            try {
                workbook.close();
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }
}
