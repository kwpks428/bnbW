# BNB Prediction Game Database

這是 BNB 預測遊戲的資料庫結構和初始化腳本。

## 檔案說明

- `init-database.sql` - PostgreSQL 資料庫初始化腳本，包含完整的資料表結構
- `setup-database.js` - Node.js 資料庫設置腳本
- `db/` - 資料庫相關的服務模組

## 資料表結構

- `round` - 局次主表
- `hisbet` - 歷史下注記錄
- `realbet` - 即時下注暫存
- `claim` - 領獎記錄
- `multi_claim` - 多局領獎檢測
- `wallet_note` - 錢包備註
- `failed_epoch` - 失敗局次記錄
- `wallet_rating` - 錢包三維度星級評等系統

## 使用方法

1. 在 Railway 或其他 PostgreSQL 服務中執行 `init-database.sql`
2. 配置環境變數中的 `DATABASE_URL`
3. 運行 `node setup-database.js` 進行初始化

## 部署到 Railway

1. 創建 PostgreSQL 資料庫
2. 複製資料庫連接字串到環境變數
3. 執行初始化腳本