# Railway 部署指南

## 🚀 部署历史抓取服务

### 步骤 1: 登录Railway
1. 访问 [Railway](https://railway.app)
2. 使用GitHub账号登录

### 步骤 2: 创建新项目
1. 点击 "New Project"
2. 选择 "Deploy from GitHub repo"
3. 选择 `kwpks428/bnbW` 仓库
4. **重要**: 在分支选择中选择 `historical-crawler`

### 步骤 3: 配置环境变量
在Railway项目设置中添加以下环境变量：

```
DATABASE_URL=postgresql://username:password@hostname:port/database
RPC_HTTP_URL=https://bsc-dataseed1.binance.org/
RPC_WS_URL=wss://bsc-ws-node.nariox.org:443/
RPC_BACKUP_URLS=https://bsc-dataseed2.binance.org/,https://bsc-dataseed3.binance.org/
CONTRACT_ADDRESS=0xYourContractAddress
```

### 步骤 4: 部署配置
Railway会自动识别 `railway.json` 配置文件：
- 启动命令: `npm start`
- 健康检查: `/health`
- 端口: 自动分配

### 步骤 5: 监控部署
- 查看部署日志确认服务正常启动
- 访问健康检查端点确认服务状态

## 🔍 健康检查
部署完成后，你可以访问：
`https://your-app-url.railway.app/health`

应该返回类似这样的响应：
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
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```