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

        // Initialize services
        const historicalCrawler = new HistoricalCrawler();
        const realtimeListener = new RealtimeListener();

        await historicalCrawler.initialize();
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
        await realtimeListener.initialize();

        // Start background workers
        historicalCrawler.start();
        // Realtime listener is already started by its initialize method

    } catch (error) {
        console.error('❌ 啟動應用程式失敗:', error);
        process.exit(1);
    }
}

startServer();