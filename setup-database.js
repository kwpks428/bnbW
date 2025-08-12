const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setupDatabase() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL 環境變數未設置');
        process.exit(1);
    }

    try {
        console.log('🔄 連接到 Railway PostgreSQL 數據庫...');
        
        // 測試連接
        const client = await pool.connect();
        console.log('✅ 數據庫連接成功');
        
        // 讀取並執行初始化腳本
        const sqlScript = fs.readFileSync(path.join(__dirname, 'init-database.sql'), 'utf8');
        console.log('📋 執行數據庫初始化腳本...');
        
        await client.query(sqlScript);
        console.log('✅ 數據庫初始化完成');
        
        // 檢查創建的表
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        console.log('📊 已創建的表:');
        tablesResult.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });
        
        client.release();
        await pool.end();
        
        console.log('🎉 數據庫設置完成！現在可以啟動應用程式了');
        console.log('💡 運行指令: npm start');
        
    } catch (error) {
        console.error('❌ 數據庫設置失敗:', error.message);
        console.error('詳細錯誤:', error);
        process.exit(1);
    }
}

setupDatabase();