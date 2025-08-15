# BNB Realtime Listener

BNB 預測遊戲即時數據監聽服務 - 專門處理區塊鏈事件監聽和 WebSocket 數據推送。

## 功能特點

- **即時事件監聽**：監聽 BetBull、BetBear、StartRound、LockRound、EndRound 事件
- **WebSocket 服務**：為前端提供即時數據推送
- **可疑行為檢測**：監控高頻下注和異常行為
- **自動重連**：WebSocket 連接斷開時自動重連
- **HTTP API**：提供服務狀態查詢接口

## 安裝與配置

1. 安裝依賴：
```bash
npm install
```

2. 配置環境變量：
```bash
cp .env.example .env
# 編輯 .env 文件，設置正確的配置值
```

3. 初始化數據庫：
```bash
# 執行 init-database.sql 來創建必要的表結構
```

## 運行

### 開發模式
```bash
npm run dev
```

### 生產模式
```bash
npm start
```

## 服務端點

### HTTP API
- `GET /status` - 查詢服務狀態

### WebSocket
- `ws://host:port/ws` - WebSocket 連接端點

## WebSocket 事件類型

### 連接事件
```json
{
  "type": "connection",
  "status": "connected",
  "timestamp": 1234567890
}
```

### 新下注事件
```json
{
  "channel": "new_bet_data",
  "data": {
    "epoch": "12345",
    "bet_ts": "2024-01-01 12:00:00",
    "wallet_address": "0x...",
    "bet_direction": "UP",
    "amount": "0.1",
    "tx_hash": "0x...",
    "block_number": 123456,
    "suspicious": {
      "isSuspicious": false,
      "flags": []
    }
  }
}
```

### 輪次事件
```json
{
  "channel": "round_event",
  "type": "start|lock|end",
  "data": {
    "epoch": "12345"
  }
}
```

## 環境變量說明

- `DATABASE_URL`: PostgreSQL 數據庫連接字符串
- `RPC_HTTP_URL`: BSC HTTP RPC 節點地址
- `RPC_WS_URL`: BSC WebSocket RPC 節點地址
- `RPC_BACKUP_URLS`: 備用 HTTP RPC 節點地址（逗號分隔）
- `CONTRACT_ADDRESS`: 預測遊戲智能合約地址
- `REALTIME_PORT`: HTTP/WebSocket 服務端口（默認 8080）

## Railway 部署

本項目已配置為可直接部署到 Railway 平台。部署時請確保：

1. 設置正確的環境變量
2. 開放 WebSocket 端口
3. 配置健康檢查端點為 `/status`

## 可疑行為檢測

系統會自動檢測以下可疑行為：
- 高頻下注：1分鐘內超過10次下注
- 異常模式：可擴展的檢測規則

## 架構說明

### 事件監聽
- 監聽智能合約的關鍵事件
- 自動處理 WebSocket 重連
- 防重複事件處理

### 數據處理
- 立即廣播到前端（降低延遲）
- 異步保存到數據庫（不阻塞廣播）
- 自動清理過期記錄