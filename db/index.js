const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const ConnectionManager = require('./ConnectionManager');
const HistoricalCrawler = require('./HistoricalCrawler');
const RealtimeListener = require('./RealtimeListener');
const { ethers } = require('ethers');

if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
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

        // API endpoints
        app.get('/api/status', (req, res) => {
            res.json({
                historicalCrawler: historicalCrawler.getStats(),
                realtimeListener: realtimeListener.getStatus(),
                connectionManager: ConnectionManager.getConnectionStats()
            });
        });

        // 獲取當前輪次信息和鎖倉時間
        app.get('/api/round-info', async (req, res) => {
            try {
                const contract = ConnectionManager.getContract();
                const currentEpoch = await contract.currentEpoch();
                
                // 獲取當前輪次的詳細信息
                const roundData = await contract.rounds(currentEpoch);
                const lockTimestamp = Number(roundData.lockTimestamp) * 1000; // 轉換為毫秒

                const totalAmount = ethers.formatEther(roundData.totalAmount || '0');
                const bullAmount = ethers.formatEther(roundData.bullAmount || '0');
                const bearAmount = ethers.formatEther(roundData.bearAmount || '0');

                const totalAmountFloat = parseFloat(totalAmount);
                const bullAmountFloat = parseFloat(bullAmount);
                const bearAmountFloat = parseFloat(bearAmount);

                const upPayout = bullAmountFloat > 0 ? (totalAmountFloat * 0.97) / bullAmountFloat : 0;
                const downPayout = bearAmountFloat > 0 ? (totalAmountFloat * 0.97) / bearAmountFloat : 0;
                
                res.json({
                    epoch: currentEpoch.toString(),
                    lockTime: lockTimestamp,
                    startTimestamp: Number(roundData.startTimestamp) * 1000,
                    closeTimestamp: Number(roundData.closeTimestamp) * 1000,
                    lockPrice: roundData.lockPrice ? roundData.lockPrice.toString() : null,
                    closePrice: roundData.closePrice ? roundData.closePrice.toString() : null,
                    totalAmount: totalAmount,
                    bullAmount: bullAmount,
                    bearAmount: bearAmount,
                    upPayout: upPayout.toFixed(4),
                    downPayout: downPayout.toFixed(4)
                });
            } catch (error) {
                console.error('獲取輪次信息失敗:', error);
                res.status(500).json({ error: '獲取輪次信息失敗', message: error.message });
            }
        });

        // 獲取最新下注數據
        app.get('/api/latest-bets', async (req, res) => {
            try {
                const contract = ConnectionManager.getContract();
                const currentEpoch = await contract.currentEpoch();
                
                // 從 realbet 表獲取當前輪次的下注數據
                const result = await ConnectionManager.executeQuery(
                    `SELECT epoch, bet_ts, wallet_address, bet_direction, amount
                     FROM realbet
                     WHERE epoch = $1
                     ORDER BY bet_ts DESC
                     LIMIT 100`,
                    [currentEpoch.toString()]
                );
                
                res.json(result.rows);
            } catch (error) {
                console.error('獲取最新下注數據失敗:', error);
                res.status(500).json({ error: '獲取最新下注數據失敗', message: error.message });
            }
        });

        // 獲取錢包歷史表現
        app.get('/api/wallet-history/:wallet/:currentEpoch', async (req, res) => {
            try {
                const { wallet, currentEpoch } = req.params;
                const startEpoch = Math.max(1, parseInt(currentEpoch) - 47); // 獲取48局歷史
                
                const result = await ConnectionManager.executeQuery(
                    `SELECT epoch, bet_direction, amount, result
                     FROM hisbet
                     WHERE wallet_address = $1 AND epoch >= $2 AND epoch <= $3
                     ORDER BY epoch DESC`,
                    [wallet.toLowerCase(), startEpoch, currentEpoch]
                );
                
                // 填充48個位置的數組
                const history = new Array(48).fill({ result: 'empty' });
                result.rows.forEach(row => {
                    const index = parseInt(currentEpoch) - parseInt(row.epoch);
                    if (index >= 0 && index < 48) {
                        history[index] = {
                            epoch: row.epoch,
                            direction: row.bet_direction,
                            amount: row.amount,
                            result: row.result || 'empty'
                        };
                    }
                });
                
                res.json(history);
            } catch (error) {
                console.error('獲取錢包歷史失敗:', error);
                res.status(500).json({ error: '獲取錢包歷史失敗', message: error.message });
            }
        });

        // 獲取錢包評等信息
        app.get('/api/wallet-rating/:wallet', async (req, res) => {
            try {
                const { wallet } = req.params;
                
                const result = await ConnectionManager.executeQuery(
                    `SELECT total_profit, win_rate, avg_bet_amount, total_bets, total_wins
                     FROM wallet_rating
                     WHERE wallet_address = $1`,
                    [wallet.toLowerCase()]
                );
                
                if (result.rows.length > 0) {
                    res.json(result.rows[0]);
                } else {
                    res.json({
                        total_profit: 0,
                        win_rate: 0,
                        avg_bet_amount: 0,
                        total_bets: 0,
                        total_wins: 0
                    });
                }
            } catch (error) {
                console.error('獲取錢包評等失敗:', error);
                res.status(500).json({ error: '獲取錢包評等失敗', message: error.message });
            }
        });

        // 獲取多局領獎錢包
        app.get('/api/multi-claimers', async (req, res) => {
            try {
                const result = await ConnectionManager.executeQuery(
                    `SELECT wallet_address, claim_count, total_amount
                     FROM multi_claim
                     WHERE total_amount >= 0.1
                     ORDER BY total_amount DESC`
                );
                
                const multiClaimers = {};
                result.rows.forEach(row => {
                    multiClaimers[row.wallet_address] = {
                        claimEpochs: row.claim_count,
                        totalAmount: parseFloat(row.total_amount)
                    };
                });
                
                res.json(multiClaimers);
            } catch (error) {
                console.error('獲取多局領獎錢包失敗:', error);
                res.status(500).json({ error: '獲取多局領獎錢包失敗', message: error.message });
            }
        });

        // 獲取錢包12局收益數據
        app.get('/api/wallet-profits-range/:currentEpoch', async (req, res) => {
            try {
                const { currentEpoch } = req.params;
                // 正確的12局範圍：從當前局次-2開始，往回看12局
                const startEpoch = Math.max(1, parseInt(currentEpoch) - 2 - 11); // 當前-2-11 = 往前推13局開始
                const endEpoch = parseInt(currentEpoch) - 2; // 到當前-2局結束
                
                console.log(`計算12局收益範圍: 局次 ${startEpoch} 到 ${endEpoch} (當前局次: ${currentEpoch})`);
                
                const result = await ConnectionManager.executeQuery(
                    `SELECT h.wallet_address,
                            SUM(CASE
                                WHEN UPPER(h.result) = 'WIN' AND h.bet_direction = 'UP' THEN h.amount * (r.up_payout - 1)
                                WHEN UPPER(h.result) = 'WIN' AND h.bet_direction = 'DOWN' THEN h.amount * (r.down_payout - 1)
                                WHEN UPPER(h.result) = 'LOSS' THEN -h.amount
                                ELSE 0
                            END) as profit_12_rounds
                     FROM hisbet h
                     LEFT JOIN round r ON h.epoch = r.epoch
                     WHERE h.epoch >= $1 AND h.epoch <= $2
                     GROUP BY h.wallet_address`,
                    [startEpoch, endEpoch]
                );
                
                const profits = {};
                result.rows.forEach(row => {
                    profits[row.wallet_address] = parseFloat(row.profit_12_rounds) || 0;
                });
                
                console.log(`計算完成，共 ${Object.keys(profits).length} 個錢包的12局收益數據`);
                res.json(profits);
            } catch (error) {
                console.error('獲取錢包12局收益失敗:', error);
                res.status(500).json({ error: '獲取錢包12局收益失敗', message: error.message });
            }
        });

        // 獲取錢包備註
        app.get('/api/wallet-notes', async (req, res) => {
            try {
                const result = await ConnectionManager.executeQuery(
                    `SELECT wallet_address, note FROM wallet_note WHERE note IS NOT NULL AND note != ''`
                );
                
                const notes = {};
                result.rows.forEach(row => {
                    notes[row.wallet_address] = row.note;
                });
                
                res.json(notes);
            } catch (error) {
                console.error('獲取錢包備註失敗:', error);
                res.status(500).json({ error: '獲取錢包備註失敗', message: error.message });
            }
        });

        // 保存錢包備註
        app.post('/api/wallet-note/:wallet', async (req, res) => {
            try {
                const { wallet } = req.params;
                const { note } = req.body;
                
                await ConnectionManager.executeQuery(
                    `INSERT INTO wallet_note (wallet_address, note)
                     VALUES ($1, $2)
                     ON CONFLICT (wallet_address)
                     DO UPDATE SET note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP`,
                    [wallet.toLowerCase(), note]
                );
                
                res.json({ success: true });
            } catch (error) {
                console.error('保存錢包備註失敗:', error);
                res.status(500).json({ error: '保存錢包備註失敗', message: error.message });
            }
        });

        // 調試：檢查 wallet_rating 表
        app.get('/api/debug/wallet-rating', async (req, res) => {
            try {
                const countResult = await ConnectionManager.executeQuery('SELECT COUNT(*) FROM wallet_rating');
                const sampleResult = await ConnectionManager.executeQuery('SELECT * FROM wallet_rating LIMIT 5');
                
                res.json({
                    totalCount: countResult.rows[0].count,
                    sampleData: sampleResult.rows,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('調試錢包評等失敗:', error);
                res.status(500).json({ error: '調試錢包評等失敗', message: error.message });
            }
        });

        // 獲取歷史下注數據（從 hisbet 表）
        app.get('/api/historical-bets/:epoch', async (req, res) => {
            try {
                const { epoch } = req.params;
        
                // 從 round 表獲取局次結果和賠率
                const roundResult = await ConnectionManager.executeQuery(
                    `SELECT result, up_payout, down_payout
                     FROM round
                     WHERE epoch = $1`,
                    [epoch]
                );
        
                const roundInfo = roundResult.rows[0];
        
                if (!roundInfo) {
                    return res.status(404).json({ error: '找不到該局次的歷史數據' });
                }
        
                // 從 hisbet 表獲取該局次的下注記錄
                const betsResult = await ConnectionManager.executeQuery(
                    `SELECT bet_ts as timestamp, wallet_address as wallet,
                            bet_direction as direction, amount, result
                     FROM hisbet
                     WHERE epoch = $1
                     ORDER BY bet_ts DESC`,
                    [epoch]
                );
        
                res.json({
                    epoch: epoch,
                    result: roundInfo.result,
                    upPayout: roundInfo.up_payout,
                    downPayout: roundInfo.down_payout,
                    bets: betsResult.rows
                });
            } catch (error) {
                console.error('獲取歷史下注數據失敗:', error);
                res.status(500).json({ error: '獲取歷史下注數據失敗', message: error.message });
            }
        });

        // 獲取即時下注數據（從 realbet 表）
        app.get('/api/realtime-bets/:epoch', async (req, res) => {
            try {
                const { epoch } = req.params;
                
                const result = await ConnectionManager.executeQuery(
                    `SELECT epoch, bet_ts as timestamp, wallet_address as wallet,
                            bet_direction as direction, amount
                     FROM realbet
                     WHERE epoch = $1
                     ORDER BY bet_ts DESC`,
                    [epoch]
                );
                
                res.json({ bets: result.rows });
            } catch (error) {
                console.error('獲取即時下注數據失敗:', error);
                res.status(500).json({ error: '獲取即時下注數據失敗', message: error.message });
            }
        });

        // 錢包迷你圖表數據端點
        app.get('/chart/mini/:address/:currentRound', async (req, res) => {
            try {
                const { address, currentRound } = req.params;
                const currentEpoch = parseInt(currentRound);
                console.log(`📊 處理錢包迷你圖表請求: ${address}, 當前局次: ${currentEpoch}`);
                
                // 構建48局的數據點，從當前局往前推47局
                const epochs = [];
                for (let i = 0; i < 48; i++) {
                    epochs.push(currentEpoch - i);
                }
                
                const miniChartData = [];
                
                // 獲取所有相關的歷史數據
                const historyResult = await ConnectionManager.executeQuery(
                    `SELECT epoch, bet_direction as direction, amount, result
                     FROM hisbet
                     WHERE wallet_address = $1 AND epoch >= $2 AND epoch <= $3
                     ORDER BY epoch DESC`,
                    [address.toLowerCase(), Math.min(...epochs), Math.max(...epochs)]
                );
                
                // 獲取當前局的即時數據
                const realtimeResult = await ConnectionManager.executeQuery(
                    `SELECT epoch, bet_direction as direction, amount
                     FROM realbet
                     WHERE wallet_address = $1 AND epoch = $2`,
                    [address.toLowerCase(), currentEpoch]
                );
                
                // 構建數據映射
                const historyMap = {};
                historyResult.rows.forEach(row => {
                    historyMap[row.epoch] = row;
                });
                
                const realtimeMap = {};
                realtimeResult.rows.forEach(row => {
                    realtimeMap[row.epoch] = row;
                });
                
                // 生成48局數據
                epochs.forEach((epoch, index) => {
                    let betData = {
                        epoch,
                        amount: 0,
                        direction: null,
                        result: 'no_bet',
                        status: index === 0 ? 'current' : (index === 1 ? 'processing' : 'historical')
                    };
                    
                    if (index === 0 && realtimeMap[epoch]) {
                        // 當前局
                        const bet = realtimeMap[epoch];
                        betData = {
                            epoch,
                            amount: parseFloat(bet.amount),
                            direction: bet.direction,
                            result: 'pending',
                            status: 'current'
                        };
                    } else if (historyMap[epoch]) {
                        // 歷史數據
                        const bet = historyMap[epoch];
                        betData = {
                            epoch,
                            amount: parseFloat(bet.amount),
                            direction: bet.direction,
                            result: bet.result || 'unknown',
                            status: index === 1 ? 'processing' : 'historical'
                        };
                    }
                    
                    miniChartData.push(betData);
                });
                
                console.log(`✅ 錢包迷你圖表數據處理完成: ${address}, 48局數據`);
                res.json({
                    wallet: address,
                    currentEpoch,
                    data: miniChartData
                });
                
            } catch (error) {
                console.error('處理錢包迷你圖表數據失敗:', error);
                res.status(500).json({ 
                    error: '處理錢包迷你圖表數據失敗', 
                    message: error.message 
                });
            }
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