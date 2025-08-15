#!/bin/bash
# Railway CLI 部署脚本 - 历史数据抓取服务

echo "🚀 开始部署 BNB 历史数据抓取服务到 Railway..."

# 检查 Railway CLI 是否已安装
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI 未安装。请先安装:"
    echo "npm install -g @railway/cli"
    echo "或访问: https://railway.app/cli"
    exit 1
fi

# 登录检查
if ! railway whoami &> /dev/null; then
    echo "🔐 请先登录 Railway:"
    railway login
fi

# 初始化项目
echo "📋 初始化 Railway 项目..."
railway init

# 设置环境变量
echo "🔧 配置环境变量..."
echo "请在 Railway Dashboard 中设置以下环境变量:"
echo ""
echo "DATABASE_URL=postgresql://username:password@hostname:port/database"
echo "RPC_HTTP_URL=https://bsc-dataseed1.binance.org/"
echo "RPC_WS_URL=wss://bsc-ws-node.nariox.org:443/"
echo "RPC_BACKUP_URLS=https://bsc-dataseed2.binance.org/,https://bsc-dataseed3.binance.org/"
echo "CONTRACT_ADDRESS=0xYourContractAddress"
echo ""
echo "按回车键继续部署..."
read -r

# 部署
echo "🚀 开始部署..."
railway up

echo "✅ 部署完成！"
echo "📊 健康检查端点: https://your-app.railway.app/health"
echo "🔗 Railway Dashboard: https://railway.app/dashboard"