# Railway 部署指南

## 🚀 部署即时监听服务

### 步骤 1: 登录Railway
1. 访问 [Railway](https://railway.app)
2. 使用GitHub账号登录

### 步骤 2: 创建新项目
1. 点击 "New Project"
2. 选择 "Deploy from GitHub repo"
3. 选择 `kwpks428/bnbW` 仓库
4. **重要**: 在分支选择中选择 `realtime-listener`

### 步骤 3: 配置环境变量
在Railway项目设置中添加以下环境变量：

```
DATABASE_URL=postgresql://username:password@hostname:port/database
RPC_HTTP_URL=https://bsc-dataseed1.binance.org/
RPC_WS_URL=wss://bsc-ws-node.nariox.org:443/
RPC_BACKUP_URLS=https://bsc-dataseed2.binance.org/,https://bsc-dataseed3.binance.org/
CONTRACT_ADDRESS=0xYourContractAddress
REALTIME_PORT=8080
```

### 步骤 4: 部署配置
Railway会自动识别 `railway.json` 配置文件：
- 启动命令: `npm start`
- 健康检查: `/status`
- 端口: 8080 (或Railway自动分配)

### 步骤 5: 监控部署
- 查看部署日志确认服务正常启动
- 访问状态端点确认服务状态

## 🔍 服务端点
部署完成后，你可以访问：

### HTTP API
- 状态检查: `https://your-app-url.railway.app/status`

### WebSocket
- WebSocket连接: `wss://your-app-url.railway.app/ws`

## 📊 状态检查响应示例
访问 `/status` 应该返回：
```json
{
  "service": "realtime-data",
  "status": {
    "isConnected": true,
    "connectedClients": 0,
    "hasWebSocketServer": true,
    "processedBetsCount": 0,
    "contractAddress": "0xYourContractAddress"
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## 🔌 WebSocket 事件
连接到WebSocket后，你会收到以下类型的事件：
- `connection` - 连接确认
- `new_bet_data` - 新的下注数据
- `round_event` - 轮次事件（开始/锁定/结束）