-- ============================================================================
-- Railway PostgreSQL 數據庫初始化腳本
-- ============================================================================

-- 設置時區為台北時間
SET timezone = 'Asia/Taipei';

-- ============================================================================
-- 1. round表 - 局次主表
-- ============================================================================
CREATE TABLE IF NOT EXISTS round (
    -- 主鍵：局次編號
    epoch BIGINT PRIMARY KEY,
    
    -- 時間軸：統一台北時間格式
    start_ts TIMESTAMP,             -- 局次開始時間
    lock_ts TIMESTAMP,              -- 鎖倉時間（停止下注）
    close_ts TIMESTAMP,             -- 局次結束時間
    
    -- 價格數據：使用高精度數值格式
    lock_price NUMERIC(20,8),       -- 鎖倉價格（開盤價）
    close_price NUMERIC(20,8),      -- 結算價格（收盤價）
    
    -- 局次結果：強制UP/DOWN標準
    result VARCHAR(4) CHECK (result IN ('UP', 'DOWN')),
    
    -- 金額統計：數值格式避免計算誤差
    total_amount NUMERIC(20,8),     -- 總下注金額
    up_amount NUMERIC(20,8),        -- UP方總金額
    down_amount NUMERIC(20,8),      -- DOWN方總金額
    
    -- 賠率計算：總金額扣3%手續費後按比例分配
    up_payout NUMERIC(10,4),        -- UP賠率 = (total_amount * 0.97) / up_amount
    down_payout NUMERIC(10,4)       -- DOWN賠率 = (total_amount * 0.97) / down_amount
);

-- round表索引優化
CREATE INDEX IF NOT EXISTS idx_round_epoch ON round(epoch);
CREATE INDEX IF NOT EXISTS idx_round_start_ts ON round(start_ts);
CREATE INDEX IF NOT EXISTS idx_round_result ON round(result);

-- ============================================================================
-- 2. hisbet表 - 歷史下注記錄
-- ============================================================================
CREATE TABLE IF NOT EXISTS hisbet (
    -- 基本信息
    epoch BIGINT,                   -- 所屬局次
    bet_ts TIMESTAMP,               -- 下注時間（台北時間）
    wallet_address VARCHAR(42),     -- 錢包地址
    
    -- 下注詳情：強制UP/DOWN標準
    bet_direction VARCHAR(4) CHECK (bet_direction IN ('UP', 'DOWN')),
    amount NUMERIC(20,8),           -- 下注金額
    
    -- 結果計算：對比局次結果得出
    result VARCHAR(4) CHECK (result IN ('WIN', 'LOSS')),
    
    -- 區塊鏈信息
    tx_hash VARCHAR(66) UNIQUE      -- 交易哈希（防重複關鍵）
);

-- hisbet表索引優化
CREATE INDEX IF NOT EXISTS idx_hisbet_epoch ON hisbet(epoch);
CREATE INDEX IF NOT EXISTS idx_hisbet_wallet ON hisbet(wallet_address);
CREATE INDEX IF NOT EXISTS idx_hisbet_ts ON hisbet(bet_ts);
CREATE INDEX IF NOT EXISTS idx_hisbet_direction ON hisbet(bet_direction);
CREATE INDEX IF NOT EXISTS idx_hisbet_result ON hisbet(result);

-- ============================================================================
-- 3. realbet表 - 即時下注暫存
-- ============================================================================
CREATE TABLE IF NOT EXISTS realbet (
    -- 基本信息
    epoch BIGINT,                   -- 所屬局次
    bet_ts TIMESTAMP,               -- 下注時間（台北時間）
    wallet_address VARCHAR(42),     -- 錢包地址
    
    -- 下注詳情：強制UP/DOWN標準
    bet_direction VARCHAR(4) CHECK (bet_direction IN ('UP', 'DOWN')),
    amount NUMERIC(20,8),           -- 下注金額
    
    -- 唯一約束：一局一錢包一次下注
    CONSTRAINT unique_realbet_epoch_wallet UNIQUE (epoch, wallet_address)
);

-- realbet表索引優化
CREATE INDEX IF NOT EXISTS idx_realbet_epoch ON realbet(epoch);
CREATE INDEX IF NOT EXISTS idx_realbet_wallet ON realbet(wallet_address);
CREATE INDEX IF NOT EXISTS idx_realbet_ts ON realbet(bet_ts);
CREATE INDEX IF NOT EXISTS idx_realbet_direction ON realbet(bet_direction);

-- ============================================================================
-- 4. claim表 - 領獎記錄
-- ============================================================================
CREATE TABLE IF NOT EXISTS claim (
    -- 領獎基本信息
    epoch BIGINT,                   -- 領獎發生的局次
    claim_ts TIMESTAMP,             -- 領獎時間（台北時間）
    wallet_address VARCHAR(42),     -- 領獎錢包
    
    -- 領獎詳情
    claim_amount NUMERIC(20,8),     -- 領獎金額
    bet_epoch BIGINT                -- 原下注局次（可能與epoch不同）
);

-- claim表索引優化
CREATE INDEX IF NOT EXISTS idx_claim_epoch ON claim(epoch);
CREATE INDEX IF NOT EXISTS idx_claim_wallet ON claim(wallet_address);
CREATE INDEX IF NOT EXISTS idx_claim_ts ON claim(claim_ts);
CREATE INDEX IF NOT EXISTS idx_claim_bet_epoch ON claim(bet_epoch);

-- ============================================================================
-- 5. multi_claim表 - 多局領獎檢測
-- ============================================================================
CREATE TABLE IF NOT EXISTS multi_claim (
    -- 基本信息：epoch:錢包地址：該局總共領獎次數：總金額
    epoch BIGINT,                   -- 局次編號
    wallet_address VARCHAR(42),     -- 錢包地址
    claim_count INTEGER,            -- 該局總共領獎次數
    total_amount NUMERIC(20,8),     -- 總金額
    
    -- 唯一性約束
    PRIMARY KEY (epoch, wallet_address)
);

-- multi_claim表索引優化
CREATE INDEX IF NOT EXISTS idx_multi_claim_wallet ON multi_claim(wallet_address);
CREATE INDEX IF NOT EXISTS idx_multi_claim_epoch ON multi_claim(epoch);

-- ============================================================================
-- 6. wallet_note表 - 錢包備註
-- ============================================================================
CREATE TABLE IF NOT EXISTS wallet_note (
    wallet_address VARCHAR(42) PRIMARY KEY,
    note TEXT
);

-- ============================================================================
-- 7. failed_epoch表 - 失敗局次記錄
-- ============================================================================
CREATE TABLE IF NOT EXISTS failed_epoch (
    epoch BIGINT PRIMARY KEY,
    failure_count INTEGER DEFAULT 1,
    last_attempt_ts TIMESTAMP DEFAULT NOW(),
    error_message TEXT,
    created_ts TIMESTAMP DEFAULT NOW()
);

-- failed_epoch表索引
CREATE INDEX IF NOT EXISTS idx_failed_epoch_count ON failed_epoch(failure_count);
CREATE INDEX IF NOT EXISTS idx_failed_epoch_attempt ON failed_epoch(last_attempt_ts);

-- ============================================================================
-- 8. wallet_rating表 - 錢包三維度星級評等系統
-- ============================================================================
CREATE TABLE IF NOT EXISTS wallet_rating (
    -- 主鍵
    wallet_address VARCHAR(42) PRIMARY KEY,
    
    -- 三維度星級評等系統
    claim_stars INTEGER DEFAULT 0,             -- 多局領獎星級 (0-2星)
    profit_stars INTEGER DEFAULT 0,            -- 總收益星級 (0-2星)
    pattern_stars INTEGER DEFAULT 0,           -- 整數下注星級 (0-1星)
    total_stars INTEGER DEFAULT 0,             -- 總星級 (0-5星)
    
    -- 歷史最高等級記錄 (空心星概念)
    max_claim_stars INTEGER DEFAULT 0,         -- 歷史最高多局領獎星級
    max_profit_stars INTEGER DEFAULT 0,        -- 歷史最高總收益星級  
    max_pattern_stars INTEGER DEFAULT 0,       -- 歷史最高整數下注星級
    max_total_stars INTEGER DEFAULT 0,         -- 歷史最高總星級
    
    -- 核心收益計算（正確公式）
    total_profit NUMERIC(20,8) DEFAULT 0,      -- 總淨收益 = 勝利收益 - 失敗損失
    total_win_profit NUMERIC(20,8) DEFAULT 0,  -- 勝利收益 = Σ(下注金額 × (賠率-1))
    total_loss_amount NUMERIC(20,8) DEFAULT 0, -- 失敗損失 = Σ(失敗局下注金額)
    total_claim_amount NUMERIC(20,8) DEFAULT 0, -- 總領獎金額
    total_claim_count INTEGER DEFAULT 0,       -- 總領獎次數
    
    -- 基礎統計
    total_bets INTEGER DEFAULT 0,              -- 總下注次數
    total_wins INTEGER DEFAULT 0,              -- 總勝利次數
    total_amount NUMERIC(20,8) DEFAULT 0,      -- 總下注金額
    total_winnings NUMERIC(20,8) DEFAULT 0,    -- 總獲利金額
    
    -- 計算指標
    win_rate NUMERIC(5,4) DEFAULT 0,           -- 總勝率 (0.0000-1.0000)
    avg_bet_amount NUMERIC(20,8) DEFAULT 0,    -- 平均下注金額
    roi NUMERIC(10,6) DEFAULT 0,               -- 投資報酬率
    
    -- 整數下注模式分析
    integer_bet_count INTEGER DEFAULT 0,       -- 整數下注次數 (末尾.000)
    integer_bet_ratio NUMERIC(5,4) DEFAULT 0,  -- 整數下注比例
    
    -- 近期表現 (最近50局)
    recent_bets INTEGER DEFAULT 0,             -- 最近下注次數
    recent_wins INTEGER DEFAULT 0,             -- 最近勝利次數
    recent_win_rate NUMERIC(5,4) DEFAULT 0,    -- 最近勝率
    
    -- 行為分析
    multi_claim_count INTEGER DEFAULT 0,       -- 多局領獎次數
    suspicious_score INTEGER DEFAULT 0,        -- 可疑分數 (0-100)
    activity_score INTEGER DEFAULT 0,          -- 活躍度分數 (0-100)
    consistency_score INTEGER DEFAULT 0,       -- 一致性分數 (0-100)
    
    -- 風險評估
    risk_level VARCHAR(10) DEFAULT 'LOW',      -- LOW, MEDIUM, HIGH, EXTREME
    
    -- 時間戳
    last_updated_ts TIMESTAMP DEFAULT NOW(),
    first_bet_ts TIMESTAMP,                    -- 首次下注時間
    last_bet_ts TIMESTAMP                      -- 最後下注時間
);

-- wallet_rating表索引
CREATE INDEX IF NOT EXISTS idx_wallet_rating_total_stars ON wallet_rating(total_stars);
CREATE INDEX IF NOT EXISTS idx_wallet_rating_profit ON wallet_rating(total_profit);
CREATE INDEX IF NOT EXISTS idx_wallet_rating_claim_stars ON wallet_rating(claim_stars);
CREATE INDEX IF NOT EXISTS idx_wallet_rating_profit_stars ON wallet_rating(profit_stars);
CREATE INDEX IF NOT EXISTS idx_wallet_rating_pattern_stars ON wallet_rating(pattern_stars);
CREATE INDEX IF NOT EXISTS idx_wallet_rating_winrate ON wallet_rating(win_rate);
CREATE INDEX IF NOT EXISTS idx_wallet_rating_risk ON wallet_rating(risk_level);
CREATE INDEX IF NOT EXISTS idx_wallet_rating_updated ON wallet_rating(last_updated_ts);

-- ============================================================================
-- 完成訊息
-- ============================================================================
SELECT 'Database initialization completed successfully!' as message;