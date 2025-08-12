const { ethers } = require('ethers');
const WebSocket = require('ws');
const ConnectionManager = require('./ConnectionManager');
const TimeService = require('./TimeService');

class SuspiciousWalletMonitor {
    constructor() {
        this.walletBetCounts = new Map();
        this.recentBets = new Map();
        this.highFrequencyWindow = 60000;
        this.maxBetsInWindow = 10;
    }

    checkSuspiciousWallet(wallet, amount, epoch) {
        const now = Date.now();
        let flags = [];

        // 總下注次數檢查
        const currentCount = (this.walletBetCounts.get(wallet) || 0) + 1;
        this.walletBetCounts.set(wallet, currentCount);

        // 高頻下注檢查
        const walletRecentBets = this.recentBets.get(wallet) || [];
        const validRecentBets = walletRecentBets.filter(time => now - time < this.highFrequencyWindow);
        validRecentBets.push(now);
        this.recentBets.set(wallet, validRecentBets);

        if (validRecentBets.length > this.maxBetsInWindow) {
            flags.push(`High frequency betting: ${validRecentBets.length} bets in the last minute.`);
        }

        return { isSuspicious: flags.length > 0, flags };
    }
}

class RealtimeListener {
    constructor() {
        this.connectionManager = ConnectionManager;
        this.suspiciousMonitor = new SuspiciousWalletMonitor();
        this.processedBets = new Map();
        this.wss = null;
        this.connectedClients = new Set();
        this.server = null;
        this.provider = null;
        this.contract = null;
    }

    setServer(server) {
        this.server = server;
    }

    async initialize() {
        try {
            console.log('🔄 初始化即時數據監聽器...');
            await this.connectionManager.initialize();
            
            // 設置 WebSocket 重連回調
            this.connectionManager.setWebSocketReconnectCallback(() => {
                console.log('🔄 [RealtimeListener] WebSocket 重連成功，重新設置事件監聽器');
                this.reattachBlockchainEvents();
            });
            
            this.provider = this.connectionManager.getWebSocketProvider();
            this.contract = this.connectionManager.getWebSocketContract();
            this.initializeWebSocketServer();
            this.setupBlockchainEvents();
            console.log('🚀 即時數據監聽器初始化成功');
        } catch (error) {
            console.error('❌ 即時數據監聽器初始化失敗:', error);
            throw error;
        }
    }

    async initializeWithoutConnectionManager() {
        try {
            console.log('🔄 初始化即時數據監聽器（使用現有連接管理器）...');
            
            // 設置 WebSocket 重連回調
            this.connectionManager.setWebSocketReconnectCallback(() => {
                console.log('🔄 [RealtimeListener] WebSocket 重連成功，重新設置事件監聽器');
                this.reattachBlockchainEvents();
            });
            
            this.provider = this.connectionManager.getWebSocketProvider();
            this.contract = this.connectionManager.getWebSocketContract();
            this.initializeWebSocketServer();
            this.setupBlockchainEvents();
            console.log('🚀 即時數據監聽器初始化成功');
        } catch (error) {
            console.error('❌ 即時數據監聽器初始化失敗:', error);
            throw error;
        }
    }

    initializeWebSocketServer() {
        if (!this.server) {
            console.error('❌ HTTP server instance not provided to RealtimeListener.');
            return;
        }
        this.wss = new WebSocket.Server({ server: this.server, path: '/ws' });

        this.wss.on('connection', (ws) => {
            console.log('🔗 New frontend client connected.');
            this.connectedClients.add(ws);
            ws.on('close', () => {
                console.log('🔌 Frontend client disconnected.');
                this.connectedClients.delete(ws);
            });
            ws.on('error', (error) => {
                console.error('❌ WebSocket client error:', error);
                this.connectedClients.delete(ws);
            });
        });
    }

    broadcastToClients(message) {
        if (this.connectedClients.size === 0) return;
        const messageStr = JSON.stringify(message);
        this.connectedClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }

    setupBlockchainEvents() {
        if (!this.contract) {
            console.error('❌ [RealtimeListener] 合約實例不存在，無法設置事件監聽器');
            return;
        }
        
        // 清理既有的事件監聽器
        this.contract.removeAllListeners();
        
        console.log('🔍 [RealtimeListener] 設置區塊鏈事件監聽器...');
        
        this.contract.on('BetBull', (sender, epoch, amount, event) => {
            this.handleBetEvent(sender, epoch, amount, event, 'UP');
        });

        this.contract.on('BetBear', (sender, epoch, amount, event) => {
            this.handleBetEvent(sender, epoch, amount, event, 'DOWN');
        });

        this.contract.on('StartRound', (epoch) => {
            console.log(`🚀 新輪次開始: ${epoch}`);
            this.broadcastToClients({
                channel: 'round_event',
                type: 'start',
                data: { epoch: epoch.toString() }
            });
        });

        this.contract.on('LockRound', (epoch) => {
            console.log(`🔒 輪次鎖定: ${epoch}`);
            this.broadcastToClients({
                channel: 'round_event',
                type: 'lock',
                data: { epoch: epoch.toString() }
            });
        });

        this.contract.on('EndRound', (epoch) => {
            console.log(`🏁 輪次結束: ${epoch}`);
            this.broadcastToClients({
                channel: 'round_event',
                type: 'end',
                data: { epoch: epoch.toString() }
            });
        });
        
        console.log('✅ [RealtimeListener] 區塊鏈事件監聽器設置完成');
    }
    
    reattachBlockchainEvents() {
        try {
            // 重新獲取 WebSocket 合約實例
            this.provider = this.connectionManager.getWebSocketProvider();
            this.contract = this.connectionManager.getWebSocketContract();
            
            // 重新設置事件監聽器
            this.setupBlockchainEvents();
            
            console.log('✅ [RealtimeListener] 區塊鏈事件監聽器重新附加成功');
        } catch (error) {
            console.error('❌ [RealtimeListener] 重新附加區塊鏈事件監聽器失敗:', error);
            // 稍後再試
            setTimeout(() => {
                this.reattachBlockchainEvents();
            }, 5000);
        }
    }

    async handleBetEvent(sender, epoch, amount, event, direction) {
        const betKey = `${epoch.toString()}_${sender.toLowerCase()}`;
        if (this.processedBets.has(betKey)) {
            return; // Skip duplicate
        }
        this.processedBets.set(betKey, Date.now());

        const betData = {
            epoch: epoch.toString(),
            bet_ts: TimeService.getCurrentTaipeiTime(),
            wallet_address: sender.toLowerCase(),
            bet_direction: direction,
            amount: ethers.formatEther(amount),
            tx_hash: event.transactionHash || '',
            block_number: event.blockNumber || 0
        };

        // 可疑行為檢查
        const suspiciousCheck = this.suspiciousMonitor.checkSuspiciousWallet(
            sender, 
            parseFloat(betData.amount), 
            betData.epoch
        );

        // 廣播到前端客戶端
        this.broadcastToClients({ 
            channel: 'new_bet_data', 
            data: { 
                ...betData, 
                suspicious: suspiciousCheck 
            } 
        });

        // 保存到 realbet 表
        try {
            await this.connectionManager.executeQuery(
                `INSERT INTO realbet (epoch, bet_ts, wallet_address, bet_direction, amount) 
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (epoch, wallet_address) DO UPDATE SET
                 bet_ts = EXCLUDED.bet_ts,
                 bet_direction = EXCLUDED.bet_direction,
                 amount = EXCLUDED.amount`,
                [betData.epoch, betData.bet_ts, betData.wallet_address, betData.bet_direction, betData.amount]
            );
            
            console.log(`💰 [即時] ${direction} 下注: ${betData.wallet_address} ${betData.amount} BNB (局次 ${betData.epoch})`);
            
            if (suspiciousCheck.isSuspicious) {
                console.log(`🚨 [即時] 可疑行為檢測: ${betData.wallet_address} - ${suspiciousCheck.flags.join(', ')}`);
            }
        } catch (error) {
            if (error.code === '23505') { // 唯一性約束違反
                console.log(`⚠️ [即時] 錢包 ${betData.wallet_address} 在局次 ${betData.epoch} 已有下注記錄，更新數據`);
            } else {
                console.error('❌ Failed to save real-time bet to database:', error);
            }
        }
    }

    // 清理過期的處理記錄
    cleanupProcessedBets() {
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        
        for (const [key, timestamp] of this.processedBets.entries()) {
            if (now - timestamp > oneHour) {
                this.processedBets.delete(key);
            }
        }
    }

    async start() {
        await this.initialize();
        
        // 每小時清理一次過期記錄
        setInterval(() => {
            this.cleanupProcessedBets();
        }, 60 * 60 * 1000);
    }

    getStatus() {
        return {
            isConnected: !!this.provider && this.connectionManager.status.wsConnected,
            connectedClients: this.connectedClients.size,
            hasWebSocketServer: !!this.wss,
            processedBetsCount: this.processedBets.size,
            contractAddress: this.connectionManager.contractConfig?.address || 'Not set'
        };
    }

    cleanup() {
        console.log('🧹 [RealtimeListener] 正在清理資源...');
        
        if (this.contract) {
            try {
                this.contract.removeAllListeners();
                console.log('✅ [RealtimeListener] 合約事件監聽器已清理');
            } catch (error) {
                console.error('❌ [RealtimeListener] 清理合約事件監聽器失敗:', error);
            }
        }
        
        if (this.wss) {
            try {
                this.wss.close();
                console.log('✅ [RealtimeListener] WebSocket 服務器已關閉');
            } catch (error) {
                console.error('❌ [RealtimeListener] 關閉 WebSocket 服務器失敗:', error);
            }
        }
        
        this.connectedClients.clear();
        this.processedBets.clear();
        console.log('✅ [RealtimeListener] 所有資源已清理完成');
    }

    stop() {
        this.cleanup();
        console.log('🛑 即時數據監聽器已停止');
    }
}

module.exports = RealtimeListener;