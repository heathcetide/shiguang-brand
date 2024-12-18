package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.LoginRequest;
import com.foodrecord.model.dto.RegisterRequest;
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
import com.foodrecord.model.entity.ThirdPartyAccount;
import com.foodrecord.model.entity.User;
import org.springframework.web.multipart.MultipartFile;

<<<<<<< HEAD
import java.util.List;
import java.util.Map;
=======
import com.foodrecord.model.entity.User;
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
import javax.mail.MessagingException;
import java.util.List;
import java.util.Map;
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2

public interface UserService extends IService<User> {
    String login(LoginRequest request);

    User register(RegisterRequest request);

    User getUserById(Long id);

    void logout(Long userId);

    User updateUser(Long id, User updateUser);
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2

    // 管理员专属操作接口
    boolean createUser(User user);

    boolean updateUserByAdmin(Long id, User user);

    boolean deleteUserByAdmin(Long id);

    Long countNewUsers(String startDate, String endDate);

    Long countActiveUsers(String startDate, String endDate);

    void logoutUser(String token);

    void resetPassword(String emailOrPhone, String newPassword);

    void changePassword(String token, String oldPassword, String newPassword);

    String uploadAvatar(MultipartFile file, String token);

    void requestAccountDeletion(String token);

<<<<<<< HEAD
    void sendVerificationCode(String emailOrPhone);
=======
    void sendVerificationCode(String emailOrPhone) throws MessagingException;
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2

    void verifyCode(String emailOrPhone, String code);

    List<User> searchPublicUsers(String keyword);

    Map<String, Object> getUserStatistics(String token);

    void bindThirdPartyAccount(String token, ThirdPartyAccount account);

    void unbindThirdPartyAccount(String token, String platform);

    void enableTwoFactorAuth(String token, String secretKey);

    void verifyTwoFactorAuth(String token, String verificationCode);
<<<<<<< HEAD
=======
>>>>>>> 760e64faa4b508a953de7474c6306365de93fe82
=======
>>>>>>> 1fe00ccf1c176d0a78d10117429d721f81a8fbb2
}
