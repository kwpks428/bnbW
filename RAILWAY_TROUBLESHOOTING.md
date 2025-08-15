# Railway 部署故障排除指南

## 🚨 当前问题诊断

你遇到的问题：
- ✅ 构建成功
- ❌ 健康检查失败 (`/health` 端点不可用)
- ❌ 服务重复重启

## 🔧 解决方案

### 1. 设置必需的环境变量

在 Railway Dashboard → Variables 中添加：

```bash
# 必需变量
DATABASE_URL=postgresql://username:password@hostname:port/database
CONTRACT_ADDRESS=0xYourContractAddress

# RPC配置（可选，有默认值）
RPC_HTTP_URL=https://bsc-dataseed1.binance.org/
RPC_WS_URL=wss://bsc-ws-node.nariox.org:443/
RPC_BACKUP_URLS=https://bsc-dataseed2.binance.org/,https://bsc-dataseed3.binance.org/

# Railway会自动设置PORT变量
```

### 2. 检查服务状态

部署完成后访问以下端点：

#### 健康检查
```
GET https://your-app.railway.app/health
```

期望响应：
```json
{
  "service": "bnb-historical-crawler",
  "status": "healthy",
  "stats": {
    "roundsProcessed": 0,
    "betsProcessed": 0,
    "claimsProcessed": 0,
    "errors": 0
  },
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 123.45
}
```

#### 基本检查
```
GET https://your-app.railway.app/
```

期望响应：
```
BNB Historical Crawler Service - OK
```

### 3. 查看部署日志

在 Railway Dashboard → Deploy Logs 中检查：

#### 正常启动日志应显示：
```
📊 獨立歷史數據服務啟動中...
🩺 健康检查服务已启动
🩺 健康檢查服務運行在端口 XXXX
📊 健康檢查端點: http://localhost:XXXX/health
```

#### 如果环境变量缺失：
```
⚠️ DATABASE_URL 未设置，历史数据功能将受限
⚠️ CONTRACT_ADDRESS 未设置，历史数据功能将受限
⏸️ 歷史數據服務暫停，等待環境變量配置
```

### 4. 常见问题解决

#### 问题1: 健康检查超时
**原因**: 环境变量未设置，服务启动失败
**解决**: 设置 `DATABASE_URL` 和 `CONTRACT_ADDRESS`

#### 问题2: 端口绑定失败
**原因**: Railway的PORT变量冲突
**解决**: 让Railway自动分配端口（不要手动设置PORT）

#### 问题3: 数据库连接失败
**原因**: `DATABASE_URL` 格式不正确
**解决**: 确保格式为 `postgresql://user:pass@host:port/dbname`

### 5. 最小工作配置

如果只想让服务运行（不处理历史数据），只需设置：
```bash
# 这样健康检查会通过，但历史处理功能暂停
# 不设置 DATABASE_URL 和 CONTRACT_ADDRESS
```

### 6. 完整配置

要启用所有功能：
```bash
DATABASE_URL=postgresql://user:pass@host:port/dbname
CONTRACT_ADDRESS=0x1234567890123456789012345678901234567890
RPC_HTTP_URL=https://bsc-dataseed1.binance.org/
RPC_WS_URL=wss://bsc-ws-node.nariox.org:443/
```

## 📞 获取帮助

如果问题仍然存在：
1. 检查 Railway Deploy Logs 中的具体错误信息
2. 确认环境变量是否正确设置
3. 尝试重新部署服务