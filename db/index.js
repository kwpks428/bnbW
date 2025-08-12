const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const ConnectionManager = require('./ConnectionManager');
const HistoricalCrawler = require('./HistoricalCrawler');
const RealtimeListener = require('./RealtimeListener');

if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

async function startServer() {
    try {
        console.log('🚀 正在啟動應用程式...');

        // 首先初始化 ConnectionManager（單例模式，確保只初始化一次）
        console.log('🔧 正在初始化連接管理器...');
        await ConnectionManager.initialize();
        console.log('✅ 連接管理器初始化完成');

        // Initialize services
        const historicalCrawler = new HistoricalCrawler();
        const realtimeListener = new RealtimeListener();

        // 初始化服務（不再重複初始化 ConnectionManager）
        console.log('🔧 正在初始化歷史數據抓取器...');
        await historicalCrawler.initializeWithoutConnectionManager();
        console.log('✅ 歷史數據抓取器初始化完成');
        // 初始化即時監聽器（不再重複初始化 ConnectionManager）
        console.log('🔧 正在初始化即時監聽器...');
        await realtimeListener.initializeWithoutConnectionManager();
        console.log('✅ 即時監聽器初始化完成');

        // API endpoint for status
        app.get('/api/status', (req, res) => {
            res.json({
                historicalCrawler: historicalCrawler.getStats(),
                realtimeListener: realtimeListener.getStatus(),
                connectionManager: ConnectionManager.getConnectionStats()
            });
        });

        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ 網頁伺服器正在連接埠 ${PORT} 上運行`)
            console.log('✨ 應用程式啟動成功！');
        });

        realtimeListener.setServer(server);

        // Start background workers
        historicalCrawler.start();
        // Realtime listener is already started by its initialize method

    } catch (error) {
        console.error('❌ 啟動應用程式失敗:', error);
        process.exit(1);
    }
}

startServer();