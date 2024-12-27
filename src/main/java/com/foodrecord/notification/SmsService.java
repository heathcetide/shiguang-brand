package com.foodrecord.notification;

public interface SmsService {

    void sendSms(String phoneNumber, String message);
}
