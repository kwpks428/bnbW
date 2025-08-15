const { ethers } = require('ethers');
const { Pool } = require('pg');
const TimeService = require('./TimeService');
const dotenv = require('dotenv');

dotenv.config();

class ConnectionManager {
    constructor() {
        if (ConnectionManager.instance) {
            throw new Error('ConnectionManager is a singleton. Use getInstance() instead.');
        }
        ConnectionManager.instance = this;

        this.dbConfig = {
            // PostgreSQL 配置
            connectionString: process.env.DATABASE_URL,
            max: 10,                        // 減少最大連接數，避免超過限制
            min: 2,                         // 減少最小連接數
            idleTimeoutMillis: 60000,       // 增加空閒超時時間到 60 秒
            connectionTimeoutMillis: 15000, // 增加連接超時時間到 15 秒
            acquireTimeoutMillis: 20000,    // 增加獲取連接超時時間
            maxUses: 7500,
            allowExitOnIdle: false,
            keepAlive: true,                // 啟用 keep-alive
            keepAliveInitialDelayMillis: 10000,
            ssl: {
                rejectUnauthorized: false   // PostgreSQL 需要SSL但允許自簽證書
            }
        };

        this.rpcConfig = {
            httpUrl: process.env.RPC_HTTP_URL,
            wsUrl: process.env.RPC_WS_URL,
            backupHttpUrls: process.env.RPC_BACKUP_URLS ? process.env.RPC_BACKUP_URLS.split(',') : [],
            backupWsUrls: [],
            timeout: 60000,
            retryAttempts: 5,
            retryDelay: 3000,
            wsHealthCheckInterval: 30000,
            wsReconnectDelay: 5000,
            currentHttpUrlIndex: 0
        };

        this.contractConfig = {
            address: process.env.CONTRACT_ADDRESS,
            abiPath: './abi.json'
        };

        this.connections = {
            dbPool: null,
            httpProvider: null,
            wsProvider: null,
            contract: null
        };

        this.status = {
            dbConnected: false,
            httpConnected: false,
            wsConnected: false,
            lastHealthCheck: null,
            reconnectAttempts: 0,
            currentWsUrlIndex: 0,
            currentHttpUrlIndex: 0,
            wsLastActivity: null,
            wsConnectionStartTime: null
        };

        this.healthCheckInterval = null;
        this.wsHealthCheckInterval = null;
        this.HEALTH_CHECK_INTERVAL = 60000;
        this.MAX_RECONNECT_ATTEMPTS = 10;
        this.RECONNECT_DELAY = 10000;
        this.WS_ACTIVITY_TIMEOUT = 120000;
        this.isReconnecting = false;

        console.log('🔧 連接管理器已初始化');
    }

    static getInstance() {
        if (!ConnectionManager.instance) {
            ConnectionManager.instance = new ConnectionManager();
        }
        return ConnectionManager.instance;
    }

    async initialize() {
        try {
            console.log('🚀 [ConnectionManager] 正在初始化所有連接...');
            await this.initializeDatabasePool();
            await this.initializeHttpProvider();
            
            // WebSocket 連接失敗時不阻止整個系統啟動
            try {
                await this.initializeWebSocketProvider();
            } catch (wsError) {
                console.warn('⚠️ [ConnectionManager] WebSocket 初始化失敗，將稍後重試:', wsError.message);
                this.status.wsConnected = false;
            }
            
            await this.initializeContract();
            this.startHealthCheck();
            console.log('✅ [ConnectionManager] 連接初始化完成');
            this.logConnectionStatus();
        } catch (error) {
            console.error('❌ [ConnectionManager] 初始化失敗:', error.message);
            throw error;
        }
    }

    async initializeDatabasePool() {
        try {
            console.log('🗄️ [ConnectionManager] 正在初始化 PostgreSQL 連接池...');
            this.connections.dbPool = new Pool(this.dbConfig);
            const client = await this.connections.dbPool.connect();
            const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
            client.release();
            this.status.dbConnected = true;
            console.log('✅ [ConnectionManager] PostgreSQL 連接池初始化成功');
            console.log(`   📊 資料庫時間: ${result.rows[0].current_time}`);
            console.log(`   📦 PostgreSQL 版本: ${result.rows[0].pg_version.split(' ')[0]}`);
            this.connections.dbPool.on('error', (err) => {
                console.error('❌ [ConnectionManager] PostgreSQL 連接池錯誤:', err.message);
                this.status.dbConnected = false;
            });
        } catch (error) {
            console.error('❌ [ConnectionManager] PostgreSQL 連接池初始化失敗:', error.message);
            this.status.dbConnected = false;
            throw error;
        }
    }

    async initializeHttpProvider() {
        const allUrls = [this.rpcConfig.httpUrl, ...this.rpcConfig.backupHttpUrls];
        
        for (let urlIndex = 0; urlIndex < allUrls.length; urlIndex++) {
            const currentUrl = allUrls[urlIndex];
            let attempt = 0;
            
            while (attempt < 3) { // 3 attempts per URL
                try {
                    attempt++;
                    console.log(`🌐 [ConnectionManager] 正在初始化 HTTP RPC 提供者... (URL ${urlIndex + 1}/${allUrls.length}, 嘗試 ${attempt}/3)`);
                    console.log(`   🔗 使用URL: ${currentUrl}`);
                    
                    // Create provider with extended timeout and retry configuration
                    this.connections.httpProvider = new ethers.JsonRpcProvider(
                        currentUrl, 
                        56, 
                        { 
                            timeout: this.rpcConfig.timeout,
                            retryLimit: 3,
                            staticNetwork: true // Use static network to avoid additional network calls
                        }
                    );
                    
                    // Test the connection with a simple call
                    const blockNumber = await Promise.race([
                        this.connections.httpProvider.getBlockNumber(),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Connection timeout')), this.rpcConfig.timeout)
                        )
                    ]);
                    
                    this.status.httpConnected = true;
                    this.status.currentHttpUrlIndex = urlIndex;
                    console.log('✅ [ConnectionManager] HTTP RPC 提供者初始化成功');
                    console.log(`   📦 Current block: ${blockNumber}`);
                    console.log(`   🔗 成功連接URL: ${currentUrl}`);
                    return; // Success, exit all loops
                    
                } catch (error) {
                    console.error(`❌ [ConnectionManager] HTTP RPC 提供者初始化失敗 (URL ${urlIndex + 1}, 嘗試 ${attempt}/3):`, error.message);
                    this.status.httpConnected = false;
                    
                    if (attempt < 3) {
                        // Wait before retry on same URL
                        console.log(`⏳ [ConnectionManager] 等待 ${this.rpcConfig.retryDelay}ms 後重試相同URL...`);
                        await new Promise(resolve => setTimeout(resolve, this.rpcConfig.retryDelay));
                    }
                }
            }
            
            console.log(`⚠️ [ConnectionManager] URL ${currentUrl} 失敗，嘗試下一個URL...`);
        }
        
        // If we get here, all URLs failed
        throw new Error(`HTTP RPC provider initialization failed for all ${allUrls.length} URLs`);
    }

    async initializeWebSocketProvider() {
        const wsUrl = this.getCurrentWebSocketUrl();
        try {
            console.log(`🔌 [ConnectionManager] 正在初始化 WebSocket 提供者 (節點 ${this.status.currentWsUrlIndex + 1})...`);
            
            // 清理舊連接
            if (this.connections.wsProvider) {
                try {
                    this.connections.wsProvider.websocket.removeAllListeners();
                    this.connections.wsProvider.websocket.close();
                } catch (e) {
                    console.warn('⚠️ [ConnectionManager] 清理舊 WebSocket 連接時出錯:', e.message);
                }
            }
            
            this.connections.wsProvider = new ethers.WebSocketProvider(wsUrl);
            this.status.wsConnectionStartTime = Date.now();
            
            this.connections.wsProvider.websocket.on('open', () => {
                console.log(`✅ [ConnectionManager] WebSocket 連接已建立 (節點 ${this.status.currentWsUrlIndex + 1})`);
                this.status.wsConnected = true;
                this.status.reconnectAttempts = 0;
                this.status.wsLastActivity = Date.now();
                this.isReconnecting = false;
                this.startWebSocketHealthCheck();
            });
            
            this.connections.wsProvider.websocket.on('message', () => {
                this.status.wsLastActivity = Date.now();
            });
            
            this.connections.wsProvider.websocket.on('close', (code, reason) => {
                console.log(`⚠️ [ConnectionManager] WebSocket 連接已關閉 (代碼: ${code}, 原因: ${reason})`);
                this.status.wsConnected = false;
                this.stopWebSocketHealthCheck();
                if (!this.isReconnecting) {
                    this.handleWebSocketReconnect();
                }
            });
            
            this.connections.wsProvider.websocket.on('error', (error) => {
                console.error(`❌ [ConnectionManager] WebSocket 錯誤 (節點 ${this.status.currentWsUrlIndex + 1}):`, error.message);
                this.status.wsConnected = false;
            });
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 15000);
                this.connections.wsProvider.websocket.on('open', () => { clearTimeout(timeout); resolve(); });
                this.connections.wsProvider.websocket.on('error', (error) => { 
                    clearTimeout(timeout); 
                    reject(error instanceof Error ? error : new Error(String(error))); 
                });
            });
            
            const network = await this.connections.wsProvider.getNetwork();
            console.log('✅ [ConnectionManager] WebSocket 提供者初始化成功');
            console.log(`   🌐 Network: ${network.name} (ChainID: ${network.chainId})`);
            console.log(`   🔗 使用節點: ${wsUrl}`);
        } catch (error) {
            console.error(`❌ [ConnectionManager] WebSocket 提供者初始化失敗 (節點 ${this.status.currentWsUrlIndex + 1}):`, error.message);
            this.status.wsConnected = false;
            throw error;
        }
    }

    async initializeContract() {
        try {
            console.log('📋 [ConnectionManager] 正在初始化智能合約實例...');
            const fs = require('fs');
            const contractABI = JSON.parse(fs.readFileSync(this.contractConfig.abiPath, 'utf8'));
            this.connections.contract = new ethers.Contract(this.contractConfig.address, contractABI, this.connections.httpProvider);
            const currentEpoch = await this.connections.contract.currentEpoch();
            console.log('✅ [ConnectionManager] 智能合約實例初始化成功');
            console.log(`   📋 合約地址: ${this.contractConfig.address}`);
            console.log(`   🎯 當前輪次: ${currentEpoch}`);
        } catch (error) {
            console.error('❌ [ConnectionManager] 智能合約實例初始化失敗:', error.message);
            throw error;
        }
    }

    getCurrentWebSocketUrl() {
        const allUrls = [this.rpcConfig.wsUrl, ...this.rpcConfig.backupWsUrls];
        return allUrls[this.status.currentWsUrlIndex % allUrls.length];
    }

    getCurrentHttpUrl() {
        const allUrls = [this.rpcConfig.httpUrl, ...this.rpcConfig.backupHttpUrls];
        return allUrls[this.status.currentHttpUrlIndex % allUrls.length];
    }
    
    async handleWebSocketReconnect() {
        if (this.isReconnecting) {
            console.log('🔄 [ConnectionManager] 重連程序已在運行中，跳過此次重連');
            return;
        }
        
        this.isReconnecting = true;
        
        if (this.status.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
            console.error('❌ [ConnectionManager] WebSocket 重連次數達到上限，嘗試下一個節點');
            this.status.currentWsUrlIndex = (this.status.currentWsUrlIndex + 1) % (1 + this.rpcConfig.backupWsUrls.length);
            this.status.reconnectAttempts = 0;
            console.log(`🔄 [ConnectionManager] 切換到節點 ${this.status.currentWsUrlIndex + 1}`);
        }
        
        this.status.reconnectAttempts++;
        const delay = Math.min(this.rpcConfig.wsReconnectDelay * this.status.reconnectAttempts, 30000);
        
        console.log(`🔄 [ConnectionManager] 嘗試 WebSocket 重連 (${this.status.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}) 延遲 ${delay}ms`);
        
        setTimeout(async () => {
            try {
                await this.initializeWebSocketProvider();
                console.log('✅ [ConnectionManager] WebSocket 重連成功');
                
                // 重新設置合約事件監聽器
                if (this.onWebSocketReconnected) {
                    this.onWebSocketReconnected();
                }
            } catch (error) {
                console.error('❌ [ConnectionManager] WebSocket 重連失敗:', error.message);
                this.isReconnecting = false;
                // 遞歸重連
                this.handleWebSocketReconnect();
            }
        }, delay);
    }

    async getDatabaseConnection() {
        // 减少日志输出，只在状态变化时记录
        const needsDebugLog = process.env.NODE_ENV === 'development' || !this.status.dbConnected;
        if (needsDebugLog) {
            console.log(`🔍 [ConnectionManager] getDatabaseConnection - dbPool: ${!!this.connections.dbPool}, dbConnected: ${this.status.dbConnected}`);
        }
        
        // 如果資料庫連接池不存在或連接狀態為 false，嘗試重新初始化
        if (!this.connections.dbPool || !this.status.dbConnected) {
            console.warn('⚠️ [ConnectionManager] 資料庫連接池未初始化或連接失敗，嘗試重新初始化...');
            try {
                await this.initializeDatabasePool();
                console.log('✅ [ConnectionManager] 資料庫連接池重新初始化成功');
            } catch (reinitError) {
                console.error('❌ [ConnectionManager] 資料庫連接池重新初始化失敗:', reinitError.message);
                throw new Error('Database pool not initialized or connection failed');
            }
        }
        
        // 嘗試獲取連接，如果失敗則重試
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const client = await this.connections.dbPool.connect();
                // 只在第一次尝试失败后记录成功日志
                if (attempt > 1 || needsDebugLog) {
                    console.log(`✅ [ConnectionManager] 成功獲取資料庫連接 (嘗試 ${attempt}/3)`);
                }
                return client;
            } catch (error) {
                console.error(`❌ [ConnectionManager] 獲取資料庫連接失敗 (嘗試 ${attempt}/3):`, error.message);
                this.status.dbConnected = false;
                
                if (attempt === 3) {
                    // 最後一次嘗試失敗，拋出錯誤
                    throw new Error(`Failed to get database connection after 3 attempts: ${error.message}`);
                }
                
                // 等待後重試
                console.log(`⏳ [ConnectionManager] 等待 ${attempt * 1000}ms 後重試...`);
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                
                // 如果不是最後一次嘗試，重新初始化連接池
                if (attempt < 3) {
                    try {
                        await this.initializeDatabasePool();
                    } catch (reinitError) {
                        console.error('❌ [ConnectionManager] 重試時重新初始化失敗:', reinitError.message);
                    }
                }
            }
        }
    }

    getHttpProvider() {
        if (!this.connections.httpProvider || !this.status.httpConnected) throw new Error('HTTP RPC Provider not initialized or connection failed');
        return this.connections.httpProvider;
    }

    getWebSocketProvider() {
        if (!this.connections.wsProvider) throw new Error('WebSocket Provider not initialized');
        return this.connections.wsProvider;
    }

    getContract() {
        if (!this.connections.contract) throw new Error('Smart contract instance not initialized');
        return this.connections.contract;
    }

    getWebSocketContract() {
        if (!this.connections.wsProvider || !this.connections.contract) throw new Error('WebSocket Provider or contract instance not initialized');
        const fs = require('fs');
        const contractABI = JSON.parse(fs.readFileSync(this.contractConfig.abiPath, 'utf8'));
        return new ethers.Contract(this.contractConfig.address, contractABI, this.connections.wsProvider);
    }

    async executeQuery(sql, params = []) {
        const client = await this.getDatabaseConnection();
        try {
            return await client.query(sql, params);
        } finally {
            client.release();
        }
    }

    async executeTransaction(queries) {
        const client = await this.getDatabaseConnection();
        try {
            await client.query('BEGIN');
            const results = [];
            for (const { sql, params } of queries) {
                results.push(await client.query(sql, params));
            }
            await client.query('COMMIT');
            return results;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async performHealthCheck() {
        const results = { database: false, httpRpc: false, webSocket: false, timestamp: new Date().toISOString() };
        try {
            await this.executeQuery('SELECT 1');
            results.database = true;
            this.status.dbConnected = true;
        } catch (error) {
            console.error('❌ [ConnectionManager] Database health check failed:', error.message);
            this.status.dbConnected = false;
        }
        try {
            await this.connections.httpProvider.getBlockNumber();
            results.httpRpc = true;
            this.status.httpConnected = true;
        } catch (error) {
            console.error('❌ [ConnectionManager] HTTP RPC health check failed:', error.message);
            this.status.httpConnected = false;
        }
        results.webSocket = this.status.wsConnected && this.connections.wsProvider?.websocket?.readyState === 1;
        this.status.lastHealthCheck = results.timestamp;
        return results;
    }

    startHealthCheck() {
        console.log('🩺 [ConnectionManager] Starting periodic health checks');
        this.healthCheckInterval = setInterval(async () => {
            const health = await this.performHealthCheck();
            const allHealthy = health.database && health.httpRpc && health.webSocket;
            if (!allHealthy) {
                console.warn('⚠️ [ConnectionManager] Health check found issues:', { database: health.database ? '✅' : '❌', httpRpc: health.httpRpc ? '✅' : '❌', webSocket: health.webSocket ? '✅' : '❌' });
                
                // 如果 WebSocket 不健康，嘗試重連
                if (!health.webSocket && !this.isReconnecting) {
                    console.log('🔧 [ConnectionManager] 健康檢查發現 WebSocket 問題，啟動重連');
                    this.handleWebSocketReconnect();
                }
            }
        }, this.HEALTH_CHECK_INTERVAL);
    }
    
    startWebSocketHealthCheck() {
        console.log('🩺 [ConnectionManager] Starting WebSocket activity monitoring');
        this.wsHealthCheckInterval = setInterval(() => {
            const now = Date.now();
            const timeSinceLastActivity = now - (this.status.wsLastActivity || now);
            
            if (timeSinceLastActivity > this.WS_ACTIVITY_TIMEOUT) {
                console.warn(`⚠️ [ConnectionManager] WebSocket 無活動超過 ${this.WS_ACTIVITY_TIMEOUT}ms，可能需要重連`);
                if (this.status.wsConnected && !this.isReconnecting) {
                    console.log('🔧 [ConnectionManager] 觸發 WebSocket 重連（無活動檢測）');
                    this.status.wsConnected = false;
                    this.handleWebSocketReconnect();
                }
            }
        }, this.rpcConfig.wsHealthCheckInterval);
    }
    
    stopWebSocketHealthCheck() {
        if (this.wsHealthCheckInterval) {
            clearInterval(this.wsHealthCheckInterval);
            this.wsHealthCheckInterval = null;
            console.log('🛑 [ConnectionManager] WebSocket 活動監控已停止');
        }
    }

    logConnectionStatus() {
        console.log('📊 [ConnectionManager] Connection status overview:');
        console.log(`   🗄️ Database: ${this.status.dbConnected ? '✅ Connected' : '❌ Disconnected'}`);
        console.log(`   🌐 HTTP RPC: ${this.status.httpConnected ? '✅ Connected' : '❌ Disconnected'}`);
        console.log(`   🔌 WebSocket: ${this.status.wsConnected ? '✅ Connected' : '❌ Disconnected'}`);
        console.log(`   📋 Smart Contract: ${this.connections.contract ? '✅ Initialized' : '❌ Not Initialized'}`);
    }

    setWebSocketReconnectCallback(callback) {
        this.onWebSocketReconnected = callback;
    }
    
    async close() {
        console.log('🛑 [ConnectionManager] Closing all connections...');
        this.isReconnecting = false;
        
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        
        this.stopWebSocketHealthCheck();
        
        if (this.connections.wsProvider) {
            try {
                this.connections.wsProvider.websocket.removeAllListeners();
                this.connections.wsProvider.websocket.close();
                console.log('✅ [ConnectionManager] WebSocket connection closed');
            } catch (error) {
                console.error('❌ [ConnectionManager] Failed to close WebSocket:', error.message);
            }
        }
        if (this.connections.dbPool) {
            try {
                await this.connections.dbPool.end();
                console.log('✅ [ConnectionManager] Database pool closed');
            } catch (error) {
                console.error('❌ [ConnectionManager] Failed to close database pool:', error.message);
            }
        }
        this.status = { 
            dbConnected: false, 
            httpConnected: false, 
            wsConnected: false, 
            lastHealthCheck: null, 
            reconnectAttempts: 0,
            currentWsUrlIndex: 0,
            currentHttpUrlIndex: 0,
            wsLastActivity: null,
            wsConnectionStartTime: null
        };
        this.connections = { dbPool: null, httpProvider: null, wsProvider: null, contract: null };
        console.log('✅ [ConnectionManager] All connections closed');
    }

    getConnectionStats() {
        return {
            status: { ...this.status },
            dbPool: this.connections.dbPool ? { totalCount: this.connections.dbPool.totalCount, idleCount: this.connections.dbPool.idleCount, waitingCount: this.connections.dbPool.waitingCount } : null,
            healthCheck: { interval: this.HEALTH_CHECK_INTERVAL, lastCheck: this.status.lastHealthCheck }
        };
    }
}

module.exports = ConnectionManager.getInstance();