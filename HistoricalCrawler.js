const { ethers } = require('ethers');
const ConnectionManager = require('./ConnectionManager');
const TimeService = require('./TimeService');

class HistoricalCrawler {
    constructor() {
        this.connectionManager = ConnectionManager;
        this.contract = null;
        this.provider = null;
        this.treasuryFeeRate = 0.03;
        this.maxRequestsPerSecond = 100;
        this.requestDelay = Math.ceil(1000 / this.maxRequestsPerSecond);
        this.lastRequestTime = 0;
        
        // 主線配置
        this.mainLine = {
            isProcessing: false,
            shouldStop: false,
            restartTimer: null,
            restartInterval: 30 * 60 * 1000 // 30分鐘
        };
        
        // 支線配置
        this.branchLine = {
            startDelay: 5 * 60 * 1000,      // 5分鐘延遲
            checkInterval: 5 * 60 * 1000,   // 每5分鐘檢查
            recentEpochsCount: 5,           // 檢查近5局
            intervalTimer: null
        };
        
        this.failedAttempts = new Map();
        this.stats = { 
            roundsProcessed: 0, 
            betsProcessed: 0, 
            claimsProcessed: 0, 
            suspiciousWalletsDetected: 0,
            errors: 0 
        };
    }

    async initialize() {
        try {
            console.log('🔄 初始化歷史數據抓取器...');
            await this.connectionManager.initialize();
            this.provider = this.connectionManager.getHttpProvider();
            this.contract = this.connectionManager.getContract();
            console.log('🚀 歷史數據抓取器初始化成功');
        } catch (error) {
            console.error('❌ 歷史數據抓取器初始化失敗:', error);
            throw error;
        }
    }

    async initializeWithoutConnectionManager() {
        try {
            console.log('🔄 初始化歷史數據抓取器（使用現有連接管理器）...');
            this.provider = this.connectionManager.getHttpProvider();
            this.contract = this.connectionManager.getContract();
            console.log('🚀 歷史數據抓取器初始化成功');
        } catch (error) {
            console.error('❌ 歷史數據抓取器初始化失敗:', error);
            throw error;
        }
    }

    start() {
        console.log('🚀 啟動雙線歷史數據抓取架構...');
        this.startMainLine();
        this.startBranchLine();
    }

    // 主線：深度回補歷史數據
    startMainLine() {
        console.log('📊 主線：立即啟動歷史數據回補');
        this.runMainLine();
        this.mainLine.restartTimer = setInterval(() => this.gracefulRestart(), this.mainLine.restartInterval);
    }

    async runMainLine() {
        this.mainLine.isProcessing = true;
        this.mainLine.shouldStop = false;
        
        try {
            const currentEpoch = await this.getCurrentEpoch();
            let checkEpoch = currentEpoch - 2;
            
            console.log(`📊 [主線] 從局次 ${checkEpoch} 開始往回檢查`);
            
            let skippedCount = 0;
            let processedCount = 0;
            let lastLogTime = Date.now();
            const LOG_INTERVAL = 10000; // 10秒記錄一次
            
            while (!this.mainLine.shouldStop && checkEpoch > 0) {
                if (!(await this.hasRoundData(checkEpoch))) {
                    console.log(`🔄 [主線] 處理局次 ${checkEpoch}`);
                    await this.processEpoch(checkEpoch);
                    processedCount++;
                    await this.delay(2000);
                } else {
                    skippedCount++;
                    
                    // 減少跳過記錄頻率，使用批量記錄
                    const now = Date.now();
                    if (now - lastLogTime > LOG_INTERVAL) {
                        console.log(`⏭️ [主線] 已跳過 ${skippedCount} 個有數據的局次，當前在局次 ${checkEpoch}`);
                        lastLogTime = now;
                        skippedCount = 0;
                    }
                }
                checkEpoch--;
            }
            
            console.log(`✅ [主線] 歷史數據回補完成或停止 - 總跳過: ${skippedCount}, 處理: ${processedCount}`);
        } catch (error) {
            console.error('❌ [主線] 處理錯誤:', error);
            this.stats.errors++;
        }
        
        this.mainLine.isProcessing = false;
    }

    async gracefulRestart() {
        console.log('🔄 [主線] 執行優雅重啟...');
        this.mainLine.shouldStop = true;
        
        while (this.mainLine.isProcessing) {
            console.log('⏳ [主線] 等待當前處理完成...');
            await this.delay(5000);
        }
        
        // 清理失敗嘗試記錄
        this.failedAttempts.clear();
        
        console.log('🚀 [主線] 重新開始歷史數據處理');
        setTimeout(() => this.runMainLine(), 2000);
    }

    // 支線：檢查最近5局
    startBranchLine() {
        console.log('⏰ 支線：將在5分鐘後啟動');
        
        setTimeout(() => {
            console.log('🔄 支線：正式啟動，開始每5分鐘檢查最近5局');
            this.runBranchLineCheck();
            this.branchLine.intervalTimer = setInterval(() => this.runBranchLineCheck(), this.branchLine.checkInterval);
        }, this.branchLine.startDelay);
    }

    async runBranchLineCheck() {
        try {
            const currentEpoch = await this.getCurrentEpoch();
            const startEpoch = currentEpoch - 2;
            
            console.log(`🔍 [支線] 檢查近${this.branchLine.recentEpochsCount}局 (${startEpoch} ~ ${startEpoch - this.branchLine.recentEpochsCount + 1})`);
            
            let missingCount = 0;
            
            for (let i = 0; i < this.branchLine.recentEpochsCount; i++) {
                const checkEpoch = startEpoch - i;
                if (checkEpoch <= 0) break;
                
                if (!(await this.hasRoundData(checkEpoch))) {
                    console.log(`🔧 [支線] 補充缺失的局次 ${checkEpoch}`);
                    await this.processEpoch(checkEpoch);
                    missingCount++;
                    await this.delay(1000);
                }
            }
            
            if (missingCount === 0) {
                console.log(`✅ [支線] 近${this.branchLine.recentEpochsCount}局數據完整，工作完成`);
            } else {
                console.log(`🔧 [支線] 已補充 ${missingCount} 局缺失數據`);
            }
        } catch (error) {
            console.error('❌ [支線] 檢查錯誤:', error);
            this.stats.errors++;
        }
    }

    // 處理單個局次
    async processEpoch(epoch) {
        try {
            console.log(`🔄 Processing epoch ${epoch}...`);
            
            if (await this.shouldSkipEpoch(epoch)) {
                console.log(`⏭️ Skipping epoch ${epoch} due to too many failures.`);
                return false;
            }

            const roundData = await this.getRoundData(epoch);
            if (!roundData) {
                console.log(`⏭️ Epoch ${epoch} is not finished or data is invalid.`);
                return false;
            }

            const { betData, claimData } = await this.getEpochEvents(epoch, roundData);
            
            // 數據完整性檢查
            if (!this.validateEpochData(epoch, roundData, betData, claimData)) {
                throw new Error(`局次 ${epoch} 數據不完整`);
            }

            // 批量保存數據
            const success = await this.saveEpochData(epoch, roundData, betData, claimData);
            if (success) {
                await this.cleanupRealbetData(epoch);
                this.failedAttempts.delete(epoch);
                this.stats.roundsProcessed++;
                this.stats.betsProcessed += betData.length;
                this.stats.claimsProcessed += claimData.length;
                console.log(`✅ Epoch ${epoch} processed successfully.`);
                return true;
            }
            
            await this.handleEpochFailure(epoch, 'Failed to save data');
            return false;
        } catch (error) {
            console.error(`❌ 處理局次 ${epoch} 失敗:`, error.message);
            await this.handleEpochFailure(epoch, error.message);
            this.stats.errors++;
            return false;
        }
    }

    // 數據完整性驗證
    validateEpochData(epoch, roundData, betData, claimData) {
        // 檢查局次數據
        if (!roundData || !roundData.epoch) {
            console.error(`❌ [驗證器] 局次 ${epoch} 基本數據不完整`);
            return false;
        }
        
        // 檢查下注數據：必須同時有UP和DOWN
        const hasUpBets = betData.some(bet => bet.bet_direction === 'UP');
        const hasDownBets = betData.some(bet => bet.bet_direction === 'DOWN');
        if (!hasUpBets || !hasDownBets) {
            console.error(`❌ [驗證器] 局次 ${epoch} 缺少看漲或看跌的下注數據`);
            return false;
        }
        
        // 檢查領獎數據：至少要有一筆
        if (!claimData || claimData.length === 0) {
            console.error(`❌ [驗證器] 局次 ${epoch} 領獎數據為空`);
            return false;
        }
        
        console.log(`✅ [驗證器] 局次 ${epoch} 數據驗證通過`);
        return true;
    }

    // 獲取局次事件數據
    async getEpochEvents(epoch, roundData) {
        const nextEpochStartTime = await this.getNextEpochStartTime(epoch + 1);
        if (!nextEpochStartTime) {
            throw new Error(`Cannot get start time for epoch ${epoch + 1}`);
        }

        const fromBlock = await this.findBlockByTimestamp(roundData.raw_start_timestamp);
        const toBlock = await this.findBlockByTimestamp(nextEpochStartTime);
        
        if (!fromBlock || !toBlock) {
            throw new Error('Could not determine block range.');
        }

        const events = await this.getEventsInRange(fromBlock, toBlock);
        
        const betData = [];
        await this.processBetEvents(events.betBullEvents, 'UP', betData, roundData.result, epoch);
        await this.processBetEvents(events.betBearEvents, 'DOWN', betData, roundData.result, epoch);

        const claimData = [];
        await this.processClaimEvents(events.claimEvents, claimData, epoch);

        return { betData, claimData };
    }

    // 批量保存數據
    async saveEpochData(epoch, roundData, betData, claimData) {
        const queries = [];
        
        // 局次數據
        queries.push({
            sql: `INSERT INTO round (epoch, start_ts, lock_ts, close_ts, lock_price, close_price, result, total_amount, up_amount, down_amount, up_payout, down_payout) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (epoch) DO NOTHING`,
            params: [roundData.epoch, roundData.start_ts, roundData.lock_ts, roundData.close_ts, roundData.lock_price, roundData.close_price, roundData.result, roundData.total_amount, roundData.up_amount, roundData.down_amount, roundData.up_payout, roundData.down_payout]
        });

        // 下注數據
        betData.forEach(bet => {
            queries.push({
                sql: `INSERT INTO hisbet (epoch, bet_ts, wallet_address, bet_direction, amount, result, tx_hash) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tx_hash) DO NOTHING`,
                params: [bet.epoch, bet.bet_ts, bet.wallet_address, bet.bet_direction, bet.amount, bet.result, bet.tx_hash]
            });
        });

        // 領獎數據
        claimData.forEach(claim => {
            queries.push({
                sql: `INSERT INTO claim (epoch, claim_ts, wallet_address, claim_amount, bet_epoch) VALUES ($1, $2, $3, $4, $5)`,
                params: [claim.epoch.toString(), claim.claim_ts, claim.wallet_address, claim.claim_amount, claim.bet_epoch.toString()]
            });
        });

        try {
            await this.connectionManager.executeTransaction(queries);
            console.log(`✅ Transaction for epoch ${epoch} committed successfully.`);
            return true;
        } catch (error) {
            console.error(`❌ Transaction for epoch ${epoch} failed:`, error.message);
            return false;
        }
    }

    // 輔助方法
    async rateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.requestDelay) {
            await new Promise(resolve => setTimeout(resolve, this.requestDelay - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
    }

    async retryRequest(operation, operationName, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await this.rateLimit();
                return await operation();
            } catch (error) {
                if (attempt === retries) {
                    console.error(`❌ ${operationName} failed after ${retries} attempts:`, error.message);
                    throw error;
                }
                const delay = 2000 * attempt;
                console.log(`⚠️ Retrying ${operationName} (attempt ${attempt}/${retries}) after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async getCurrentEpoch() {
        return Number(await this.retryRequest(() => this.contract.currentEpoch(), 'getCurrentEpoch'));
    }

    async getRoundData(epoch) {
        const round = await this.retryRequest(() => this.contract.rounds(epoch), `getRoundData for epoch ${epoch}`);
        if (Number(round.closeTimestamp) === 0) return null;

        const result = Number(round.closePrice) > Number(round.lockPrice) ? 'UP' : 'DOWN';
        const totalAmount = parseFloat(ethers.formatEther(round.totalAmount));
        const bullAmount = parseFloat(ethers.formatEther(round.bullAmount));
        const bearAmount = parseFloat(ethers.formatEther(round.bearAmount));
        const payouts = this.calculatePayouts(totalAmount, bullAmount, bearAmount);

        return {
            epoch: Number(round.epoch),
            start_ts: TimeService.formatUnixTimestamp(Number(round.startTimestamp)),
            lock_ts: TimeService.formatUnixTimestamp(Number(round.lockTimestamp)),
            close_ts: TimeService.formatUnixTimestamp(Number(round.closeTimestamp)),
            raw_start_timestamp: Number(round.startTimestamp),
            lock_price: ethers.formatUnits(round.lockPrice, 8),
            close_price: ethers.formatUnits(round.closePrice, 8),
            result,
            total_amount: totalAmount.toString(),
            up_amount: bullAmount.toString(),
            down_amount: bearAmount.toString(),
            up_payout: payouts.upPayout,
            down_payout: payouts.downPayout
        };
    }

    calculatePayouts(totalAmount, upAmount, downAmount) {
        const totalAfterFee = totalAmount * (1 - this.treasuryFeeRate);
        const upPayout = upAmount > 0 ? (totalAfterFee / upAmount).toFixed(4) : 0;
        const downPayout = downAmount > 0 ? (totalAfterFee / downAmount).toFixed(4) : 0;
        return { upPayout, downPayout };
    }

    async getNextEpochStartTime(nextEpoch) {
        const round = await this.retryRequest(() => this.contract.rounds(nextEpoch), `getNextEpochStartTime for ${nextEpoch}`);
        return Number(round.startTimestamp) === 0 ? null : Number(round.startTimestamp);
    }

    async findBlockByTimestamp(targetTimestamp) {
        const currentBlock = await this.retryRequest(() => this.provider.getBlockNumber(), 'getBlockNumber');
        let low = 1;
        let high = currentBlock;
        let closestBlock = high;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const block = await this.retryRequest(() => this.provider.getBlock(mid), `getBlock ${mid}`);
            if (!block) {
                high = mid - 1;
                continue;
            }
            if (block.timestamp < targetTimestamp) {
                low = mid + 1;
            } else if (block.timestamp > targetTimestamp) {
                high = mid - 1;
            } else {
                return mid;
            }
            closestBlock = mid;
        }
        return closestBlock;
    }

    async getEventsInRange(fromBlock, toBlock) {
        const betBullFilter = this.contract.filters.BetBull();
        const betBearFilter = this.contract.filters.BetBear();
        const claimFilter = this.contract.filters.Claim();

        const [betBullEvents, betBearEvents, claimEvents] = await Promise.all([
            this.retryRequest(() => this.contract.queryFilter(betBullFilter, fromBlock, toBlock), 'getBetBullEvents'),
            this.retryRequest(() => this.contract.queryFilter(betBearFilter, fromBlock, toBlock), 'getBetBearEvents'),
            this.retryRequest(() => this.contract.queryFilter(claimFilter, fromBlock, toBlock), 'getClaimEvents')
        ]);

        return { betBullEvents, betBearEvents, claimEvents };
    }

    async processBetEvents(events, direction, betData, roundResult, epoch) {
        for (const event of events) {
            try {
                // 檢查事件結構
                if (!event || !event.args) {
                    console.warn(`⚠️ [歷史抓取] 跳過無效事件:`, event);
                    continue;
                }
                
                // 只處理當前局次的事件
                const eventEpoch = Number(event.args.epoch || event.args[0]);
                if (eventEpoch !== epoch) continue;
                
                // 獲取事件參數（支持不同的參數格式）
                const sender = event.args.sender || event.args[1];
                const amount = event.args.amount || event.args[2];
                
                if (!sender || !amount) {
                    console.warn(`⚠️ [歷史抓取] 事件缺少必要參數:`, { sender, amount, args: event.args });
                    continue;
                }
                
                const blockTimestamp = (await this.retryRequest(() => this.provider.getBlock(event.blockNumber), `getBlock ${event.blockNumber}`)).timestamp;
                betData.push({
                    epoch: eventEpoch,
                    bet_ts: TimeService.formatUnixTimestamp(blockTimestamp),
                    wallet_address: sender.toLowerCase(),
                    bet_direction: direction,
                    amount: ethers.formatEther(amount),
                    result: roundResult ? (direction === roundResult ? 'WIN' : 'LOSS') : null,
                    tx_hash: event.transactionHash
                });
            } catch (error) {
                console.error(`❌ [歷史抓取] 處理${direction}事件失敗:`, error.message, event);
                continue;
            }
        }
    }

    async processClaimEvents(events, claimData, processingEpoch) {
        for (const event of events) {
            try {
                // 檢查事件結構
                if (!event || !event.args) {
                    console.warn(`⚠️ [歷史抓取] 跳過無效領獎事件:`, event);
                    continue;
                }
                
                // 獲取事件參數（支持不同的參數格式）
                const sender = event.args.sender || event.args[0];
                const betEpoch = event.args.epoch || event.args[1];
                const amount = event.args.amount || event.args[2];
                
                if (!sender || !amount || betEpoch === undefined) {
                    console.warn(`⚠️ [歷史抓取] 領獎事件缺少必要參數:`, { sender, amount, betEpoch, args: event.args });
                    continue;
                }
                
                const blockTimestamp = (await this.retryRequest(() => this.provider.getBlock(event.blockNumber), `getBlock ${event.blockNumber}`)).timestamp;
                claimData.push({
                    epoch: processingEpoch,
                    claim_ts: TimeService.formatUnixTimestamp(blockTimestamp),
                    wallet_address: sender.toLowerCase(),
                    claim_amount: ethers.formatEther(amount),
                    bet_epoch: Number(betEpoch)
                });
            } catch (error) {
                console.error(`❌ [歷史抓取] 處理領獎事件失敗:`, error.message, event);
                continue;
            }
        }
    }

    async hasRoundData(epoch) {
        const result = await this.connectionManager.executeQuery('SELECT epoch FROM round WHERE epoch = $1', [epoch]);
        return result.rows.length > 0;
    }

    async cleanupRealbetData(epoch) {
        await this.connectionManager.executeQuery('DELETE FROM realbet WHERE epoch = $1', [epoch]);
        console.log(`🧹 已清理局次 ${epoch} 的 realbet 數據`);
    }

    async handleEpochFailure(epoch, reason) {
        const attempts = (this.failedAttempts.get(epoch) || 0) + 1;
        this.failedAttempts.set(epoch, attempts);
        if (attempts >= 3) {
            await this.recordFailedEpoch(epoch, reason);
            console.log(`🚫 Epoch ${epoch} failed 3 times, recording and skipping.`);
            this.failedAttempts.delete(epoch);
        } else {
            await this.connectionManager.executeQuery('DELETE FROM round WHERE epoch = $1', [epoch]);
            console.log(`🗑️ Deleted partial data for epoch ${epoch}, will retry (attempt ${attempts}/3).`);
        }
    }

    async recordFailedEpoch(epoch, errorMessage) {
        await this.connectionManager.executeQuery('INSERT INTO failed_epoch (epoch, error_message, last_attempt_ts) VALUES ($1, $2, NOW()) ON CONFLICT (epoch) DO UPDATE SET error_message = EXCLUDED.error_message, last_attempt_ts = NOW(), failure_count = failed_epoch.failure_count + 1', [epoch, errorMessage]);
    }

    async shouldSkipEpoch(epoch) {
        const result = await this.connectionManager.executeQuery('SELECT failure_count FROM failed_epoch WHERE epoch = $1', [epoch]);
        return result.rows.length > 0 && result.rows[0].failure_count >= 3;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    stop() {
        console.log('🛑 停止歷史數據抓取雙線架構...');
        
        this.mainLine.shouldStop = true;
        
        if (this.mainLine.restartTimer) {
            clearInterval(this.mainLine.restartTimer);
            this.mainLine.restartTimer = null;
        }
        
        if (this.branchLine.intervalTimer) {
            clearInterval(this.branchLine.intervalTimer);
            this.branchLine.intervalTimer = null;
        }
        
        console.log('✅ 雙線架構已停止');
    }

    getStats() {
        return {
            ...this.stats,
            mainLineActive: !!this.mainLine.restartTimer,
            branchLineActive: !!this.branchLine.intervalTimer,
            isProcessingHistory: this.mainLine.isProcessing,
            failedAttempts: this.failedAttempts.size
        };
    }
}

// 獨立啟動邏輯
if (require.main === module) {
    const http = require('http');
    const historicalService = new HistoricalCrawler();
    let httpServer = null;
    
    // 創建簡單的HTTP服務器用於健康檢查
    function createHealthCheckServer() {
        const PORT = process.env.PORT || 3000;
        
        httpServer = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            
            if (req.url === '/health' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    service: 'bnb-historical-crawler',
                    status: 'healthy',
                    stats: historicalService.getStats(),
                    timestamp: new Date().toISOString()
                }));
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });
        
        httpServer.listen(PORT, '0.0.0.0', () => {
            console.log(`🩺 健康檢查服務運行在端口 ${PORT}`);
            console.log(`📊 健康檢查端點: http://localhost:${PORT}/health`);
        });
    }
    
    // 優雅關閉處理
    process.on('SIGINT', () => {
        console.log('🛑 收到關閉信號，正在停止歷史數據服務...');
        historicalService.stop();
        if (httpServer) {
            httpServer.close(() => {
                console.log('🛑 健康檢查服務器已關閉');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });

    process.on('SIGTERM', () => {
        console.log('🛑 收到終止信號，正在停止歷史數據服務...');
        historicalService.stop();
        if (httpServer) {
            httpServer.close(() => {
                console.log('🛑 健康檢查服務器已關閉');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });

    // 啟動服務
    async function startHistoricalService() {
        try {
            console.log('📊 獨立歷史數據服務啟動中...');
            await historicalService.initialize();
            historicalService.start();
            createHealthCheckServer();
            console.log('✅ 獨立歷史數據服務已啟動');
            console.log('🎯 專門處理歷史數據回補和補齊');
            
            // 每30秒輸出統計信息
            setInterval(() => {
                const stats = historicalService.getStats();
                console.log(`📈 統計: 處理${stats.roundsProcessed}局, 下注${stats.betsProcessed}筆, 領獎${stats.claimsProcessed}筆, 錯誤${stats.errors}次`);
            }, 30000);
            
        } catch (error) {
            console.error('💥 歷史數據服務啟動失敗:', error);
            process.exit(1);
        }
    }

    startHistoricalService();
}

module.exports = HistoricalCrawler;