package com.foodrecord.service.system;

import com.alibaba.otter.canal.protocol.CanalEntry;
import com.alibaba.otter.canal.protocol.Message;
import com.alibaba.otter.canal.client.CanalConnector;
import com.alibaba.otter.canal.client.CanalConnectors;
import com.google.protobuf.InvalidProtocolBufferException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.net.InetSocketAddress;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Service
public class BinlogListenerService {

    @Value("${canal.server.address}")
    private String canalServerAddress;

    @Value("${canal.server.destination}")
    private String canalDestination;

    @Value("${canal.server.port}")
    private Integer canalServerPort;

    private final StringRedisTemplate redisTemplate;

    public BinlogListenerService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void startListening() throws InvalidProtocolBufferException {
        // 建立 Canal 连接
        CanalConnector canalConnector = CanalConnectors.newSingleConnector(
                new InetSocketAddress(canalServerAddress, canalServerPort),
                canalDestination, "", "");

        canalConnector.connect();
        canalConnector.subscribe(".*\\..*"); // 订阅所有表

        while (true) {
            // 获取 binlog 信息
            Message message = canalConnector.getWithoutAck(100, 1000L, TimeUnit.MILLISECONDS); // Correct method signature
            List<CanalEntry.Entry> entries = message.getEntries();

            for (CanalEntry.Entry entry : entries) {
                if (entry.getEntryType() == CanalEntry.EntryType.ROWDATA) {
                    CanalEntry.RowChange rowChange = CanalEntry.RowChange.parseFrom(entry.getStoreValue());
                    CanalEntry.EventType eventType = rowChange.getEventType();

                    if (eventType == CanalEntry.EventType.INSERT || eventType == CanalEntry.EventType.UPDATE) {
                        handleRowData(entry, rowChange); // Pass entry to handleRowData
                    }
                }
            }
        }
    }

    private void handleRowData(CanalEntry.Entry entry, CanalEntry.RowChange rowChange) {
        // 获取表名
        String tableName = entry.getHeader().getTableName();

        // 判断是否是目标表
        if ("food".equals(tableName)) {
            for (CanalEntry.RowData rowData : rowChange.getRowDatasList()) {
                for (CanalEntry.Column column : rowData.getAfterColumnsList()) {
                    // 假设 ID 存储在 column 的值中
                    String foodId = column.getValue(); // 假设 ID 是这个字段
                    String updatedData = getUpdatedDataFromDB(foodId);

                    // 异步更新 Redis 缓存
                    new Thread(() -> redisTemplate.opsForValue().set("food:" + foodId, updatedData)).start();
                }
            }
        }
    }

    private String getUpdatedDataFromDB(String foodId) {
        // 这里可以从数据库获取最新的数据
        return "Updated Data from DB for food ID " + foodId;
    }
}
