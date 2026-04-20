/**
 * 联机交友后端服务器
 * 支持用户注册/登录、角色上线、好友搜索、消息转发
 */

const WebSocket = require('ws');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const activation = require('./activation-server');

// 配置
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// MySQL 连接池配置（不允许 fallback，强制使用环境变量）
const dbConfig = {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// 创建连接池
let db;

// 初始化数据库
async function initDB() {
    // ❗ 启动时强制校验环境变量（不允许连接到错误的数据库）
    if (!dbConfig.host || !dbConfig.user || !dbConfig.database) {
        console.error('❌ MySQL 环境变量未注入，拒绝启动');
        console.error('当前环境变量:');
        console.error({
            MYSQL_HOST: process.env.MYSQL_HOST || '❌ 未设置',
            MYSQL_PORT: process.env.MYSQL_PORT || '❌ 未设置',
            MYSQL_USER: process.env.MYSQL_USER || '❌ 未设置',
            MYSQL_DATABASE: process.env.MYSQL_DATABASE || '❌ 未设置',
            MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ? '✅ 已设置' : '❌ 未设置'
        });
        console.error('\n⚠️  请确保 Backend 和 MySQL 在同一个 Zeabur Project 中');
        process.exit(1);
    }
    
    console.log('🔗 正在连接 MySQL 数据库...');
    console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`   User: ${dbConfig.user}`);
    console.log(`   Database: ${dbConfig.database}`);
    
    try {
        db = mysql.createPool(dbConfig);
        
        // 测试连接
        const connection = await db.getConnection();
        console.log('✅ MySQL 连接成功');
        connection.release();
        
        // 打印数据库指纹（用于确认数据持久化）
        const [dbInfo] = await db.execute('SELECT DATABASE() as db_name, VERSION() as version');
        const [userCount] = await db.execute('SELECT COUNT(*) as count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [dbConfig.database, 'users']);
        
        console.log('📊 数据库指纹:');
        console.log(`   数据库名: ${dbInfo[0].db_name}`);
        console.log(`   MySQL 版本: ${dbInfo[0].version}`);
        console.log(`   users 表存在: ${userCount[0].count > 0 ? '✅ 是' : '❌ 否（首次部署）'}`);
        
        // 如果表已存在，打印数据统计
        if (userCount[0].count > 0) {
            const [stats] = await db.execute('SELECT COUNT(*) as count FROM users');
            console.log(`   已注册用户数: ${stats[0].count}`);
        }
        
        // 创建表
        console.log('📋 正在创建数据表...');
        
        // 用户表（主账号）
        await db.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(36) PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100),
                password_hash VARCHAR(255) NOT NULL,
                created_at BIGINT DEFAULT 0,
                last_login BIGINT,
                INDEX idx_users_username (username)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        
        // 在线角色表
        await db.execute(`
            CREATE TABLE IF NOT EXISTS online_characters (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                wx_account VARCHAR(100) UNIQUE NOT NULL,
                nickname VARCHAR(100) NOT NULL,
                avatar TEXT,
                bio TEXT,
                is_online TINYINT DEFAULT 0,
                last_seen BIGINT,
                created_at BIGINT DEFAULT 0,
                INDEX idx_online_chars_wx (wx_account),
                INDEX idx_online_chars_user (user_id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        
        // 好友关系表
        await db.execute(`
            CREATE TABLE IF NOT EXISTS friendships (
                id VARCHAR(36) PRIMARY KEY,
                char_a_wx VARCHAR(100) NOT NULL,
                char_b_wx VARCHAR(100) NOT NULL,
                created_at BIGINT DEFAULT 0,
                UNIQUE KEY unique_friendship (char_a_wx, char_b_wx),
                INDEX idx_friendships_char_a (char_a_wx),
                INDEX idx_friendships_char_b (char_b_wx)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        
        // 好友申请表
        await db.execute(`
            CREATE TABLE IF NOT EXISTS friend_requests (
                id VARCHAR(36) PRIMARY KEY,
                from_wx_account VARCHAR(100) NOT NULL,
                to_wx_account VARCHAR(100) NOT NULL,
                message TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                created_at BIGINT DEFAULT 0,
                updated_at BIGINT,
                INDEX idx_friend_requests_to (to_wx_account)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        
        // 离线消息表
        await db.execute(`
            CREATE TABLE IF NOT EXISTS offline_messages (
                id VARCHAR(36) PRIMARY KEY,
                from_wx_account VARCHAR(100) NOT NULL,
                to_wx_account VARCHAR(100) NOT NULL,
                content LONGTEXT NOT NULL,
                created_at BIGINT DEFAULT 0,
                delivered TINYINT DEFAULT 0,
                INDEX idx_offline_messages_to (to_wx_account)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        
        // 联机群聊表 - 强制重建（修复表结构问题）
        console.log('🔄 重建群聊表...');
        await db.execute('SET FOREIGN_KEY_CHECKS = 0');
        await db.execute('DROP TABLE IF EXISTS online_group_messages');
        await db.execute('DROP TABLE IF EXISTS online_group_members');
        await db.execute('DROP TABLE IF EXISTS online_groups');
        await db.execute('SET FOREIGN_KEY_CHECKS = 1');
        
        await db.execute(`
            CREATE TABLE IF NOT EXISTS online_groups (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                avatar TEXT,
                creator_wx VARCHAR(100) NOT NULL,
                created_at BIGINT DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        
        await db.execute(`
            CREATE TABLE IF NOT EXISTS online_group_members (
                id VARCHAR(36) PRIMARY KEY,
                group_id VARCHAR(36) NOT NULL,
                user_wx VARCHAR(100) NOT NULL,
                character_name VARCHAR(100),
                character_avatar TEXT,
                character_desc TEXT,
                joined_at BIGINT DEFAULT 0,
                UNIQUE KEY unique_group_member (group_id, user_wx),
                INDEX idx_online_group_members_group (group_id),
                FOREIGN KEY (group_id) REFERENCES online_groups(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        
        await db.execute(`
            CREATE TABLE IF NOT EXISTS online_group_messages (
                id VARCHAR(36) PRIMARY KEY,
                group_id VARCHAR(36) NOT NULL,
                sender_type VARCHAR(20) NOT NULL,
                sender_wx VARCHAR(100) NOT NULL,
                sender_name VARCHAR(100) NOT NULL,
                character_name VARCHAR(100),
                content LONGTEXT NOT NULL,
                msg_type VARCHAR(20) DEFAULT 'text',
                created_at BIGINT DEFAULT 0,
                INDEX idx_online_group_messages_group (group_id),
                FOREIGN KEY (group_id) REFERENCES online_groups(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        
        console.log('✅ 群聊表结构正确');
        
        // ✅ 检查 online_group_members 表的列是否正确
        try {
            const [columns] = await db.execute(`
                SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'online_group_members'
                ORDER BY ORDINAL_POSITION
            `, [dbConfig.database]);
            
            console.log('📋 online_group_members 表结构:');
            columns.forEach(col => {
                console.log(`   - ${col.COLUMN_NAME}: ${col.DATA_TYPE}${col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : ''}`);
            });
            
            // 检查是否有 character_avatar 字段且类型正确
            const avatarCol = columns.find(c => c.COLUMN_NAME === 'character_avatar');
            if (!avatarCol) {
                console.log('⚠️  缺少 character_avatar 字段，需要修复表结构');
            } else if (avatarCol.DATA_TYPE === 'varchar' && avatarCol.CHARACTER_MAXIMUM_LENGTH < 1000) {
                console.log('⚠️  character_avatar 字段类型不正确，需要修复为 TEXT 或 LONGTEXT');
            }
        } catch (checkError) {
            console.log('ℹ️ 表结构检查:', checkError.message);
        }
        
        console.log('✅ 数据表创建完成');
        
        // ✅ 数据库迁移：修改avatar字段为TEXT类型（防止"Data too long"错误）
        try {
            await db.execute(`
                ALTER TABLE online_characters 
                MODIFY COLUMN avatar TEXT
            `);
            console.log('✅ 数据库迁移：avatar字段已更新为TEXT类型');
        } catch (alterError) {
            // 如果字段已经是TEXT类型，会报错，忽略即可
            if (!alterError.message.includes('Duplicate column name')) {
                console.log('ℹ️ avatar字段迁移:', alterError.message);
            }
        }
        
        // ✅ 数据库迁移：修改消息内容字段为LONGTEXT类型（支持大图片）
        console.log('🔄 正在升级消息表以支持大图片...');
        try {
            await db.execute(`
                ALTER TABLE offline_messages 
                MODIFY COLUMN content LONGTEXT NOT NULL
            `);
            console.log('✅ offline_messages.content 已更新为 LONGTEXT');
        } catch (alterError) {
            console.log('ℹ️ offline_messages.content 迁移:', alterError.message);
        }
        
        try {
            await db.execute(`
                ALTER TABLE online_group_messages 
                MODIFY COLUMN content LONGTEXT NOT NULL
            `);
            console.log('✅ online_group_messages.content 已更新为 LONGTEXT');
        } catch (alterError) {
            console.log('ℹ️ online_group_messages.content 迁移:', alterError.message);
        }
        
        // ✅ 修复可能的表结构不匹配问题
        console.log('🔧 检查并修复表结构...');
        try {
            // 删除可能存在的旧表（如果表结构有问题）
            // 检查 online_group_members 表结构
            const [columns] = await db.execute(`
                SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'online_group_members'
                ORDER BY ORDINAL_POSITION
            `, [dbConfig.database]);
            
            const columnNames = columns.map(c => c.COLUMN_NAME);
            const requiredColumns = ['id', 'group_id', 'user_wx', 'character_name', 'character_avatar', 'character_desc', 'joined_at'];
            
            // 检查是否缺少必要字段
            const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));
            
            // 检查 character_avatar 的数据类型
            const avatarCol = columns.find(c => c.COLUMN_NAME === 'character_avatar');
            const needsRebuild = missingColumns.length > 0 || (avatarCol && !['text', 'mediumtext', 'longtext'].includes(avatarCol.DATA_TYPE.toLowerCase()));
            
            if (needsRebuild) {
                if (missingColumns.length > 0) {
                    console.log(`⚠️  检测到 online_group_members 表缺少字段: ${missingColumns.join(', ')}`);
                }
                if (avatarCol && !['text', 'mediumtext', 'longtext'].includes(avatarCol.DATA_TYPE.toLowerCase())) {
                    console.log(`⚠️  character_avatar 字段类型错误: ${avatarCol.DATA_TYPE} (应为 TEXT)`);
                }
                console.log('🔄 正在重建表...');
                
                // 删除旧表并重建
                await db.execute('DROP TABLE IF EXISTS online_group_messages');
                await db.execute('DROP TABLE IF EXISTS online_group_members');
                await db.execute('DROP TABLE IF EXISTS online_groups');
                
                // 重新创建群聊表
                await db.execute(`
                    CREATE TABLE online_groups (
                        id VARCHAR(36) PRIMARY KEY,
                        name VARCHAR(100) NOT NULL,
                        avatar TEXT,
                        creator_wx VARCHAR(100) NOT NULL,
                        created_at BIGINT DEFAULT 0
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                `);
                
                await db.execute(`
                    CREATE TABLE online_group_members (
                        id VARCHAR(36) PRIMARY KEY,
                        group_id VARCHAR(36) NOT NULL,
                        user_wx VARCHAR(100) NOT NULL,
                        character_name VARCHAR(100),
                        character_avatar TEXT,
                        character_desc TEXT,
                        joined_at BIGINT DEFAULT 0,
                        UNIQUE KEY unique_group_member (group_id, user_wx),
                        INDEX idx_online_group_members_group (group_id),
                        FOREIGN KEY (group_id) REFERENCES online_groups(id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                `);
                
                await db.execute(`
                    CREATE TABLE online_group_messages (
                        id VARCHAR(36) PRIMARY KEY,
                        group_id VARCHAR(36) NOT NULL,
                        sender_type VARCHAR(20) NOT NULL,
                        sender_wx VARCHAR(100) NOT NULL,
                        sender_name VARCHAR(100) NOT NULL,
                        character_name VARCHAR(100),
                        content LONGTEXT NOT NULL,
                        msg_type VARCHAR(20) DEFAULT 'text',
                        created_at BIGINT DEFAULT 0,
                        INDEX idx_online_group_messages_group (group_id),
                        FOREIGN KEY (group_id) REFERENCES online_groups(id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                `);
                
                console.log('✅ 群聊表已重建');
            } else {
                console.log('✅ 表结构检查通过');
            }
        } catch (checkError) {
            console.log('ℹ️ 表结构检查:', checkError.message);
        }
        
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
        throw error;
    }
}

// 在线连接管理
const clients = new Map(); // socket -> { userId, wxAccounts: Set }
const wxAccountToSocket = new Map(); // wxAccount -> socket

// 创建 HTTP 服务器
const http = require('http');

function fetchJsonFromMinimax(path, method = 'GET', body = null, apiKey = '') {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.minimax.io',
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
            }
        }, (upstreamRes) => {
            let chunks = '';
            upstreamRes.on('data', chunk => chunks += chunk);
            upstreamRes.on('end', () => {
                resolve({ statusCode: upstreamRes.statusCode || 500, body: chunks });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function applyCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function readJsonBody(req) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch (e) {
        throw new Error('invalid_json_body');
    }
}

const server = http.createServer(async (req, res) => {
    applyCors(res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url?.startsWith('/ai/analyze')) {
        try {
            const body = await readJsonBody(req);
            const hasScreen = !!body?.screen;
            const hasAudio = !!body?.audio;
            const targetName = (body?.targetCharName || '').trim();

            const tips = [];
            if (targetName) tips.push(`目标角色：${targetName}`);
            tips.push(hasScreen ? '已收到屏幕关键帧' : '未收到屏幕关键帧');
            tips.push(hasAudio ? '已收到音频状态' : '未收到音频状态');

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                text: `屏幕共享分析请求已收到。${tips.join('，')}。你可在后端接入真实AI分析逻辑。`
            }));
            return;
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: false,
                error: e.message || 'bad_request'
            }));
            return;
        }
    }

    if (req.url?.startsWith('/api/minimax/')) {
        try {
            const apiKey = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
            if (!apiKey) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'missing_api_key' }));
                return;
            }
            if (req.url.startsWith('/api/minimax/models')) {
                const upstream = await fetchJsonFromMinimax('/v1/models', 'GET', null, apiKey);
                res.writeHead(upstream.statusCode, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(upstream.body);
                return;
            }
            if (req.url.startsWith('/api/minimax/text_to_speech')) {
                let raw = '';
                for await (const chunk of req) raw += chunk;
                const upstream = await fetchJsonFromMinimax('/v1/text_to_speech', 'POST', raw ? JSON.parse(raw) : {}, apiKey);
                res.writeHead(upstream.statusCode, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(upstream.body);
                return;
            }
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
            return;
        }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        status: 'ok', 
        message: '联机服务器运行中',
        connections: clients.size,
        websocket: 'ws://此地址:' + PORT
    }));
});

// 创建 WebSocket 服务器（不指定 path，处理所有 WebSocket 升级请求）
const wss = new WebSocket.Server({ server });

// 心跳检测：每30秒检查一次所有连接
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('[WS] 心跳超时，关闭连接');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(); // 发送 ping，等待 pong 响应
    });
}, 30000);

// 处理 WebSocket 连接
wss.on('connection', (ws, req) => {
    console.log('[WS] 新连接，来自:', req.socket.remoteAddress);
    
    // 初始化客户端状态
    clients.set(ws, { userId: null, wxAccounts: new Set() });
    
    // 心跳检测：标记连接为活跃
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // 处理客户端发来的心跳
            if (data.type === 'ping') {
                send(ws, { type: 'pong' });
                return;
            }
            handleMessage(ws, data);
        } catch (e) {
            console.error('[WS] 消息解析错误:', e);
            sendError(ws, '消息格式错误');
        }
    });
    
    ws.on('close', () => {
        console.log('[WS] 连接断开');
        handleDisconnect(ws);
    });
    
    ws.on('error', (error) => {
        console.error('[WS] 错误:', error);
    });
});

// 处理消息
async function handleMessage(ws, data) {
    console.log('[WS] 收到消息:', data.type);
    
    try {
        switch (data.type) {
            case 'register':
                await handleRegister(ws, data);
                break;
            case 'login':
                await handleLogin(ws, data);
                break;
            case 'auth':
                await handleAuth(ws, data);
                break;
            case 'logout':
                await handleLogout(ws);
                break;
            case 'go_online':
                await handleGoOnline(ws, data);
                break;
            case 'go_offline':
                await handleGoOffline(ws, data);
                break;
            case 'get_online_characters':
                await handleGetOnlineCharacters(ws);
                break;
            case 'search_user':
                await handleSearchUser(ws, data);
                break;
            case 'register_character':
                await handleRegisterCharacter(ws, data);
                break;
            case 'friend_request':
                await handleFriendRequest(ws, data);
                break;
            case 'accept_friend_request':
                await handleAcceptFriendRequest(ws, data);
                break;
            case 'reject_friend_request':
                await handleRejectFriendRequest(ws, data);
                break;
            case 'message':
                await handleSendMessage(ws, data);
                break;
            case 'get_pending_requests':
                await handleGetPendingRequests(ws, data);
                break;
            
            // 联机群聊
            case 'create_online_group':
                await handleCreateOnlineGroup(ws, data);
                break;
            case 'invite_to_group':
                await handleInviteToGroup(ws, data);
                break;
            case 'join_online_group':
                await handleJoinOnlineGroup(ws, data);
                break;
            case 'get_online_groups':
                await handleGetOnlineGroups(ws, data);
                break;
            case 'get_group_messages':
                await handleGetGroupMessages(ws, data);
                break;
            case 'send_group_message':
                await handleSendGroupMessage(ws, data);
                break;
            case 'get_group_members':
                await handleGetGroupMembers(ws, data);
                break;
            case 'update_group_character':
                await handleUpdateGroupCharacter(ws, data);
                break;
            case 'group_typing_start':
                await handleGroupTypingStart(ws, data);
                break;
            case 'group_typing_stop':
                await handleGroupTypingStop(ws, data);
                break;
            case 'claim_group_redpacket':
                await handleClaimGroupRedPacket(ws, data);
                break;
                
            default:
                sendError(ws, '未知的消息类型');
        }
    } catch (error) {
        console.error('[处理消息错误]', error);
        console.error('错误类型:', data.type, '数据:', JSON.stringify(data).substring(0, 200));
        sendError(ws, '服务器内部错误: ' + (error.message || '未知错误'));
    }
}

// 注册
async function handleRegister(ws, data) {
    const { username, email, password } = data;
    
    if (!username || !password) {
        sendError(ws, '用户名和密码不能为空');
        return;
    }
    
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        sendError(ws, '用户名只能包含字母、数字和下划线，长度3-20位');
        return;
    }
    
    if (password.length < 6) {
        sendError(ws, '密码至少6位');
        return;
    }
    
    // 检查用户名是否已存在
    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length > 0) {
        sendError(ws, '用户名已被注册');
        return;
    }
    
    // 创建用户
    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    
    try {
        await db.execute(
            'INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
            [userId, username, email || null, passwordHash, Date.now()]
        );
        
        // 生成token
        const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' });
        
        // 设置客户端状态
        const clientData = clients.get(ws);
        clientData.userId = userId;
        
        send(ws, {
            type: 'register_success',
            token,
            user: { id: userId, username }
        });
        
        console.log(`[注册] 新用户: ${username}`);
    } catch (e) {
        console.error('[注册] 错误:', e);
        sendError(ws, '注册失败');
    }
}

// 登录
async function handleLogin(ws, data) {
    const { username, password } = data;
    
    if (!username || !password) {
        sendError(ws, '用户名和密码不能为空');
        return;
    }
    
    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
        sendError(ws, '用户名或密码错误');
        return;
    }
    
    const user = rows[0];
    if (!bcrypt.compareSync(password, user.password_hash)) {
        sendError(ws, '用户名或密码错误');
        return;
    }
    
    // 更新最后登录时间
    await db.execute('UPDATE users SET last_login = ? WHERE id = ?', [Date.now(), user.id]);
    
    // 生成token
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    
    // 设置客户端状态
    const clientData = clients.get(ws);
    clientData.userId = user.id;
    
    send(ws, {
        type: 'login_success',
        token,
        user: { id: user.id, username: user.username }
    });
    
    console.log(`[登录] 用户: ${username}`);
}

// Token认证
async function handleAuth(ws, data) {
    const { token } = data;
    
    if (!token) {
        send(ws, { type: 'auth_failed', message: '未提供token' });
        return;
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [decoded.userId]);
        
        if (rows.length === 0) {
            send(ws, { type: 'auth_failed', message: '用户不存在' });
            return;
        }
        
        const user = rows[0];
        
        // 设置客户端状态
        const clientData = clients.get(ws);
        clientData.userId = user.id;
        
        send(ws, {
            type: 'auth_success',
            user: { id: user.id, username: user.username }
        });
        
        console.log(`[认证] 用户: ${user.username}`);
        
        // 恢复之前上线的角色
        await restoreUserCharacters(ws, user.id);
        
    } catch (e) {
        send(ws, { type: 'auth_failed', message: 'token无效或已过期' });
    }
}

// 恢复用户角色
async function restoreUserCharacters(ws, userId) {
    try {
        const [chars] = await db.execute('SELECT * FROM online_characters WHERE user_id = ?', [userId]);
        const clientData = clients.get(ws);
        
        // 将之前在线的角色重新设置为在线
        chars.filter(c => c.is_online).forEach(char => {
            clientData.wxAccounts.add(char.wx_account);
            wxAccountToSocket.set(char.wx_account, ws);
        });
        
        // 发送在线角色列表
        await handleGetOnlineCharacters(ws);
        
        // 投递离线消息
        for (const char of chars) {
            await deliverOfflineMessages(ws, char.wx_account);
        }
    } catch (error) {
        console.error('[恢复用户角色错误]', error);
    }
}

// 登出
async function handleLogout(ws) {
    const clientData = clients.get(ws);
    if (!clientData) return;
    
    // 将所有角色设为离线
    if (clientData.userId) {
        await db.execute(
            'UPDATE online_characters SET is_online = 0, last_seen = ? WHERE user_id = ?',
            [Date.now(), clientData.userId]
        );
    }
    
    // 清理映射
    clientData.wxAccounts.forEach(wx => {
        wxAccountToSocket.delete(wx);
    });
    
    clientData.userId = null;
    clientData.wxAccounts.clear();
    
    console.log('[登出]');
}

// 角色上线
async function handleGoOnline(ws, data) {
    try {
        const clientData = clients.get(ws);
        if (!clientData.userId) {
            sendError(ws, '请先登录');
            return;
        }
        
        let { wx_account, nickname, avatar, bio } = data;
        
        if (!wx_account || !nickname) {
            sendError(ws, '微信号和昵称不能为空');
            console.log('[上线失败] 缺少必填字段:', { wx_account, nickname });
            return;
        }
        
        // ✅ 截断过长的avatar（如果是base64图片太大，只保留URL或清空）
        if (avatar && avatar.length > 10000) {
            console.log(`[上线] avatar过长(${avatar.length}字符)，将被清空`);
            avatar = '';
        }
        
        // 检查微信号是否被其他用户占用
        const [existing] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [wx_account]);
        if (existing.length > 0 && existing[0].user_id !== clientData.userId) {
            sendError(ws, '该微信号已被其他用户使用');
            return;
        }
        
        // 创建或更新角色
        const charId = existing.length > 0 ? existing[0].id : uuidv4();
        await db.execute(`
            INSERT INTO online_characters (id, user_id, wx_account, nickname, avatar, bio, is_online, last_seen, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON DUPLICATE KEY UPDATE
                nickname = VALUES(nickname),
                avatar = VALUES(avatar),
                bio = VALUES(bio),
                is_online = 1,
                last_seen = VALUES(last_seen)
        `, [charId, clientData.userId, wx_account, nickname, avatar || '', bio || '', Date.now(), Date.now()]);
        
        // 更新映射
        clientData.wxAccounts.add(wx_account);
        wxAccountToSocket.set(wx_account, ws);
        
        send(ws, {
            type: 'character_online',
            wx_account,
            nickname
        });
        
        // 投递离线消息
        await deliverOfflineMessages(ws, wx_account);
        
        // 投递待处理的好友申请
        await deliverPendingFriendRequests(ws, wx_account);
        
        console.log(`[上线] ${nickname} (${wx_account})`);
    } catch (error) {
        console.error('[上线错误]', error);
        sendError(ws, '上线失败: ' + error.message);
    }
}

// 角色下线
async function handleGoOffline(ws, data) {
    const clientData = clients.get(ws);
    const { wx_account } = data;
    
    if (!wx_account || !clientData.wxAccounts.has(wx_account)) {
        return;
    }
    
    await db.execute(
        'UPDATE online_characters SET is_online = 0, last_seen = ? WHERE wx_account = ?',
        [Date.now(), wx_account]
    );
    clientData.wxAccounts.delete(wx_account);
    wxAccountToSocket.delete(wx_account);
    
    send(ws, { type: 'character_offline', wx_account });
    
    console.log(`[下线] ${wx_account}`);
}

// 获取已上线角色
async function handleGetOnlineCharacters(ws) {
    const clientData = clients.get(ws);
    if (!clientData.userId) {
        send(ws, { type: 'online_characters', characters: [] });
        return;
    }
    
    // 直接查询数据库中标记为在线的角色
    const [chars] = await db.execute('SELECT * FROM online_characters WHERE user_id = ? AND is_online = 1', [clientData.userId]);
    
    send(ws, {
        type: 'online_characters',
        characters: chars.map(c => ({
            wx_account: c.wx_account,
            nickname: c.nickname,
            avatar: c.avatar,
            bio: c.bio
        }))
    });
    
    console.log(`[查询在线角色] 用户 ${clientData.userId} 有 ${chars.length} 个角色在线`);
}

// 注册角色（不上线，仅用于搜索）
async function handleRegisterCharacter(ws, data) {
    try {
        const clientData = clients.get(ws);
        if (!clientData.userId) {
            sendError(ws, '请先登录');
            return;
        }
        
        let { wx_account, nickname, avatar, bio } = data;
        
        if (!wx_account || !nickname) {
            sendError(ws, '微信号和昵称不能为空');
            console.log('[注册角色失败] 缺少必填字段:', { wx_account, nickname });
            return;
        }
        
        // ✅ 截断过长的avatar（如果是base64图片太大，只保留URL或清空）
        if (avatar && avatar.length > 10000) {
            console.log(`[注册角色] avatar过长(${avatar.length}字符)，将被清空`);
            avatar = '';
        }
        
        // 检查微信号是否被其他用户占用
        const [existing] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [wx_account]);
        if (existing.length > 0 && existing[0].user_id !== clientData.userId) {
            sendError(ws, '该微信号已被其他用户使用');
            return;
        }
        
        // 注册角色（不上线，is_online = 0）
        const charId = existing.length > 0 ? existing[0].id : uuidv4();
        await db.execute(`
            INSERT INTO online_characters (id, user_id, wx_account, nickname, avatar, bio, is_online, last_seen, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
            ON DUPLICATE KEY UPDATE
                nickname = VALUES(nickname),
                avatar = VALUES(avatar),
                bio = VALUES(bio),
                last_seen = VALUES(last_seen)
        `, [charId, clientData.userId, wx_account, nickname, avatar || '', bio || '', Date.now(), Date.now()]);
        
        console.log(`[注册角色] ${nickname} (${wx_account}) - 未上线，仅用于搜索`);
    } catch (error) {
        console.error('[注册角色错误]', error);
        sendError(ws, '注册角色失败: ' + error.message);
    }
}

// 搜索用户
async function handleSearchUser(ws, data) {
    const { wx_account } = data;
    
    console.log('[搜索] 收到搜索请求:', wx_account);
    
    if (!wx_account) {
        console.log('[搜索] 微信号为空');
        send(ws, { type: 'search_result', result: null });
        return;
    }
    
    // 尝试精确匹配（不区分大小写）
    const [rows] = await db.execute('SELECT * FROM online_characters WHERE LOWER(wx_account) = LOWER(?)', [wx_account]);
    
    if (rows.length === 0) {
        console.log('[搜索] 未找到微信号:', wx_account);
        send(ws, { type: 'search_result', result: null });
        return;
    }
    
    const char = rows[0];
    console.log('[搜索] 找到用户:', char.nickname, '微信号:', char.wx_account, '在线状态:', char.is_online);
    
    send(ws, {
        type: 'search_result',
        result: {
            wx_account: char.wx_account,
            nickname: char.nickname,
            avatar: char.avatar,
            // 不返回 bio（人设），保护隐私
            is_online: !!char.is_online
        }
    });
}

// 发送好友申请
async function handleFriendRequest(ws, data) {
    const clientData = clients.get(ws);
    const { from_wx_account, to_wx_account, message } = data;
    
    if (!clientData.wxAccounts.has(from_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查目标是否存在
    const [toChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [to_wx_account]);
    if (toChar.length === 0) {
        sendError(ws, '目标用户不存在');
        return;
    }
    
    // 检查是否已经是好友
    const [alreadyFriends] = await db.execute(
        'SELECT 1 FROM friendships WHERE (char_a_wx = ? AND char_b_wx = ?) OR (char_a_wx = ? AND char_b_wx = ?)',
        [from_wx_account, to_wx_account, to_wx_account, from_wx_account]
    );
    if (alreadyFriends.length > 0) {
        sendError(ws, '你们已经是好友了');
        return;
    }
    
    // 创建好友申请
    const requestId = uuidv4();
    await db.execute(
        'INSERT INTO friend_requests (id, from_wx_account, to_wx_account, message, created_at) VALUES (?, ?, ?, ?, ?)',
        [requestId, from_wx_account, to_wx_account, message || '', Date.now()]
    );
    
    // 获取发送者信息
    const [fromChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [from_wx_account]);
    
    // 如果目标在线，立即推送
    const toSocket = wxAccountToSocket.get(to_wx_account);
    if (toSocket) {
        send(toSocket, {
            type: 'friend_request',
            request: {
                id: requestId,
                from_wx_account,
                from_nickname: fromChar[0]?.nickname || from_wx_account,
                from_avatar: fromChar[0]?.avatar || '',
                message: message || '',
                time: Date.now()
            }
        });
    }
    
    console.log(`[好友申请] ${from_wx_account} -> ${to_wx_account}`);
}

// 接受好友申请
async function handleAcceptFriendRequest(ws, data) {
    const clientData = clients.get(ws);
    const { request_id, my_wx_account } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    const [requests] = await db.execute('SELECT * FROM friend_requests WHERE id = ?', [request_id]);
    if (requests.length === 0 || requests[0].to_wx_account !== my_wx_account) {
        sendError(ws, '好友申请不存在');
        return;
    }
    
    const request = requests[0];
    if (request.status !== 'pending') {
        sendError(ws, '该申请已处理');
        return;
    }
    
    // 更新申请状态
    await db.execute(
        'UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?',
        ['accepted', Date.now(), request_id]
    );
    
    // 创建好友关系
    const friendshipId = uuidv4();
    await db.execute(
        'INSERT IGNORE INTO friendships (id, char_a_wx, char_b_wx, created_at) VALUES (?, ?, ?, ?)',
        [friendshipId, request.from_wx_account, my_wx_account, Date.now()]
    );
    
    // 获取双方信息
    const [myChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [my_wx_account]);
    const [theirChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [request.from_wx_account]);
    
    // 通知申请者
    const theirSocket = wxAccountToSocket.get(request.from_wx_account);
    if (theirSocket) {
        send(theirSocket, {
            type: 'friend_request_accepted',
            friend_wx_account: my_wx_account,
            friend_nickname: myChar[0]?.nickname || my_wx_account,
            friend_avatar: myChar[0]?.avatar || '',
            friend_bio: myChar[0]?.bio || ''
        });
    }
    
    // 通知自己
    send(ws, {
        type: 'friend_request_accepted',
        friend_wx_account: request.from_wx_account,
        friend_nickname: theirChar[0]?.nickname || request.from_wx_account,
        friend_avatar: theirChar[0]?.avatar || '',
        friend_bio: theirChar[0]?.bio || ''
    });
    
    console.log(`[好友申请接受] ${request.from_wx_account} <-> ${my_wx_account}`);
}

// 拒绝好友申请
async function handleRejectFriendRequest(ws, data) {
    const { request_id, my_wx_account } = data;
    const clientData = clients.get(ws);
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    const [requests] = await db.execute('SELECT * FROM friend_requests WHERE id = ?', [request_id]);
    if (requests.length === 0 || requests[0].to_wx_account !== my_wx_account) {
        sendError(ws, '好友申请不存在');
        return;
    }
    
    await db.execute(
        'UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?',
        ['rejected', Date.now(), request_id]
    );
    
    console.log(`[好友申请拒绝] ${requests[0].from_wx_account} -> ${my_wx_account}`);
}

// 发送消息
async function handleSendMessage(ws, data) {
    const clientData = clients.get(ws);
    const { from_wx_account, to_wx_account, content } = data;
    
    if (!clientData.wxAccounts.has(from_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查是否是好友
    const [areFriends] = await db.execute(
        'SELECT 1 FROM friendships WHERE (char_a_wx = ? AND char_b_wx = ?) OR (char_a_wx = ? AND char_b_wx = ?)',
        [from_wx_account, to_wx_account, to_wx_account, from_wx_account]
    );
    if (areFriends.length === 0) {
        sendError(ws, '你们还不是好友');
        return;
    }
    
    // 获取发送者信息
    const [fromChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [from_wx_account]);
    
    // 检查目标是否在线
    const toSocket = wxAccountToSocket.get(to_wx_account);
    if (toSocket) {
        send(toSocket, {
            type: 'message',
            from_wx_account,
            from_nickname: fromChar[0]?.nickname || from_wx_account,
            from_avatar: fromChar[0]?.avatar || '',
            content,
            timestamp: Date.now()
        });
    } else {
        // 保存离线消息
        const msgId = uuidv4();
        await db.execute(
            'INSERT INTO offline_messages (id, from_wx_account, to_wx_account, content, created_at) VALUES (?, ?, ?, ?, ?)',
            [msgId, from_wx_account, to_wx_account, content, Date.now()]
        );
    }
    
    console.log(`[消息] ${from_wx_account} -> ${to_wx_account}`);
}

// 获取待处理的好友申请
async function handleGetPendingRequests(ws, data) {
    const clientData = clients.get(ws);
    const { wx_account } = data;
    
    if (!clientData.wxAccounts.has(wx_account)) {
        return;
    }
    
    const [requests] = await db.execute(
        'SELECT * FROM friend_requests WHERE to_wx_account = ? AND status = ?',
        [wx_account, 'pending']
    );
    
    const result = [];
    for (const r of requests) {
        const [fromChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [r.from_wx_account]);
        result.push({
            id: r.id,
            from_wx_account: r.from_wx_account,
            from_nickname: fromChar[0]?.nickname || r.from_wx_account,
            from_avatar: fromChar[0]?.avatar || '',
            message: r.message,
            time: r.created_at
        });
    }
    
    send(ws, {
        type: 'pending_friend_requests',
        requests: result
    });
}

// 投递离线消息
async function deliverOfflineMessages(ws, wxAccount) {
    try {
        const [messages] = await db.execute(
            'SELECT * FROM offline_messages WHERE to_wx_account = ? AND delivered = 0 ORDER BY created_at',
            [wxAccount]
        );
        
        for (const msg of messages) {
            const [fromChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [msg.from_wx_account]);
            send(ws, {
                type: 'message',
                from_wx_account: msg.from_wx_account,
                from_nickname: fromChar[0]?.nickname || msg.from_wx_account,
                from_avatar: fromChar[0]?.avatar || '',
                content: msg.content,
                timestamp: msg.created_at
            });
        }
        
        if (messages.length > 0) {
            await db.execute('UPDATE offline_messages SET delivered = 1 WHERE to_wx_account = ?', [wxAccount]);
            console.log(`[离线消息] 投递 ${messages.length} 条消息给 ${wxAccount}`);
        }
    } catch (error) {
        console.error('[投递离线消息错误]', error);
        // 不影响上线流程，只记录错误
    }
}

// 投递待处理的好友申请
async function deliverPendingFriendRequests(ws, wxAccount) {
    try {
        const [requests] = await db.execute(
            'SELECT * FROM friend_requests WHERE to_wx_account = ? AND status = ?',
            [wxAccount, 'pending']
        );
        
        for (const r of requests) {
            const [fromChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [r.from_wx_account]);
            send(ws, {
                type: 'friend_request',
                request: {
                    id: r.id,
                    from_wx_account: r.from_wx_account,
                    from_nickname: fromChar[0]?.nickname || r.from_wx_account,
                    from_avatar: fromChar[0]?.avatar || '',
                    message: r.message,
                    time: r.created_at
                }
            });
        }
    } catch (error) {
        console.error('[投递好友申请错误]', error);
        // 不影响上线流程，只记录错误
    }
}

// 处理断开连接
async function handleDisconnect(ws) {
    const clientData = clients.get(ws);
    if (!clientData) return;
    
    // 将所有角色设为离线
    for (const wx of clientData.wxAccounts) {
        await db.execute(
            'UPDATE online_characters SET is_online = 0, last_seen = ? WHERE wx_account = ?',
            [Date.now(), wx]
        );
        wxAccountToSocket.delete(wx);
    }
    
    clients.delete(ws);
}

// 发送消息
function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// 发送错误
function sendError(ws, message) {
    send(ws, { type: 'error', message });
}

// ==================== 联机群聊功能 ====================

// 创建联机群聊
async function handleCreateOnlineGroup(ws, data) {
    const clientData = clients.get(ws);
    if (!clientData.userId) {
        sendError(ws, '请先登录');
        return;
    }
    
    const { name, my_wx_account, invite_wx_accounts, my_character } = data;
    
    console.log('[创建群聊] 收到请求:', {
        name,
        my_wx_account,
        invite_count: invite_wx_accounts?.length || 0,
        has_character: !!my_character,
        character_keys: my_character ? Object.keys(my_character) : []
    });
    
    if (!name || !my_wx_account) {
        sendError(ws, '群名称和创建者微信号不能为空');
        return;
    }
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 创建群聊
    const groupId = uuidv4();
    await db.execute(
        'INSERT INTO online_groups (id, name, avatar, creator_wx, created_at) VALUES (?, ?, ?, ?, ?)',
        [groupId, name, '', my_wx_account, Date.now()]
    );
    
    // 添加创建者为成员
    const memberId = uuidv4();
    try {
        // ✅ 安全提取角色信息，确保所有参数都有效
        const characterName = my_character && my_character.name ? my_character.name : null;
        let characterAvatar = my_character && my_character.avatar ? my_character.avatar : null;
        const characterDesc = my_character && my_character.desc ? my_character.desc : null;
        
        // ✅ 截断过长的 avatar（防止超出TEXT限制）
        if (characterAvatar && characterAvatar.length > 65000) {
            console.log(`[创建群聊] 角色头像过长(${characterAvatar.length}字符)，将被截断`);
            characterAvatar = characterAvatar.substring(0, 65000);
        }
        
        console.log('[创建群聊] 准备插入成员:', {
            memberId,
            groupId,
            my_wx_account,
            characterName,
            avatarLength: characterAvatar ? characterAvatar.length : 0,
            descLength: characterDesc ? characterDesc.length : 0
        });
        
        await db.execute(
            'INSERT INTO online_group_members (id, group_id, user_wx, character_name, character_avatar, character_desc, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [memberId, groupId, my_wx_account, characterName, characterAvatar, characterDesc, Date.now()]
        );
    } catch (insertError) {
        console.error('[创建群聊] 插入成员失败:', insertError.message);
        console.error('[创建群聊] 完整错误:', insertError);
        console.error('[创建群聊] 数据:', {
            memberId,
            groupId,
            my_wx_account,
            characterName: my_character?.name,
            avatarLength: my_character?.avatar?.length || 0,
            descLength: my_character?.desc?.length || 0
        });
        
        // ✅ 插入失败时回滚（删除已创建的群聊）
        try {
            await db.execute('DELETE FROM online_groups WHERE id = ?', [groupId]);
            console.log('[创建群聊] 已回滚群聊创建');
        } catch (rollbackError) {
            console.error('[创建群聊] 回滚失败:', rollbackError.message);
        }
        
        // 如果是参数错误，尝试删除并重建表
        if (insertError.message.includes('Incorrect arguments')) {
            console.log('🔄 检测到表结构问题，正在修复...');
            await db.execute('DROP TABLE IF EXISTS online_group_messages');
            await db.execute('DROP TABLE IF EXISTS online_group_members');
            
            await db.execute(`
                CREATE TABLE online_group_members (
                    id VARCHAR(36) PRIMARY KEY,
                    group_id VARCHAR(36) NOT NULL,
                    user_wx VARCHAR(100) NOT NULL,
                    character_name VARCHAR(100),
                    character_avatar TEXT,
                    character_desc TEXT,
                    joined_at BIGINT DEFAULT 0,
                    UNIQUE KEY unique_group_member (group_id, user_wx),
                    INDEX idx_online_group_members_group (group_id),
                    FOREIGN KEY (group_id) REFERENCES online_groups(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            
            await db.execute(`
                CREATE TABLE online_group_messages (
                    id VARCHAR(36) PRIMARY KEY,
                    group_id VARCHAR(36) NOT NULL,
                    sender_type VARCHAR(20) NOT NULL,
                    sender_wx VARCHAR(100) NOT NULL,
                    sender_name VARCHAR(100) NOT NULL,
                    character_name VARCHAR(100),
                    content LONGTEXT NOT NULL,
                    msg_type VARCHAR(20) DEFAULT 'text',
                    created_at BIGINT DEFAULT 0,
                    INDEX idx_online_group_messages_group (group_id),
                    FOREIGN KEY (group_id) REFERENCES online_groups(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            
            console.log('✅ 表结构已修复，重新插入');
            // 重新插入（使用已处理过的变量）
            await db.execute(
                'INSERT INTO online_group_members (id, group_id, user_wx, character_name, character_avatar, character_desc, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [memberId, groupId, my_wx_account, characterName, characterAvatar, characterDesc, Date.now()]
            );
        } else {
            throw insertError;
        }
    }
    
    // 获取创建者信息
    const [creatorChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [my_wx_account]);
    
    // 给创建者发送成功消息
    send(ws, {
        type: 'online_group_created',
        group: {
            id: groupId,
            name: name,
            creator_wx: my_wx_account,
            created_at: Date.now()
        }
    });
    
    // 邀请好友
    if (invite_wx_accounts && invite_wx_accounts.length > 0) {
        invite_wx_accounts.forEach(inviteWx => {
            const inviteSocket = wxAccountToSocket.get(inviteWx);
            if (inviteSocket) {
                send(inviteSocket, {
                    type: 'group_invite',
                    group_id: groupId,
                    group_name: name,
                    inviter_wx: my_wx_account,
                    inviter_name: creatorChar[0]?.nickname || my_wx_account
                });
            }
        });
    }
    
    console.log(`[群聊] 创建群聊: ${name} (${groupId}) by ${my_wx_account}`);
}

// 邀请好友加入群聊
async function handleInviteToGroup(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, invite_wx_account } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查群是否存在
    const [group] = await db.execute('SELECT * FROM online_groups WHERE id = ?', [group_id]);
    if (group.length === 0) {
        sendError(ws, '群聊不存在');
        return;
    }
    
    // 检查邀请者是否是群成员
    const [member] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ? AND user_wx = ?', [group_id, my_wx_account]);
    if (member.length === 0) {
        sendError(ws, '你不是该群的成员');
        return;
    }
    
    // 获取邀请者信息
    const [inviterChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [my_wx_account]);
    
    // 发送邀请
    const inviteSocket = wxAccountToSocket.get(invite_wx_account);
    if (inviteSocket) {
        send(inviteSocket, {
            type: 'group_invite',
            group_id: group_id,
            group_name: group[0].name,
            inviter_wx: my_wx_account,
            inviter_name: inviterChar[0]?.nickname || my_wx_account
        });
    }
    
    console.log(`[群聊] 邀请 ${invite_wx_account} 加入群 ${group[0].name}`);
}

// 加入群聊
async function handleJoinOnlineGroup(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, my_character } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查群是否存在
    const [group] = await db.execute('SELECT * FROM online_groups WHERE id = ?', [group_id]);
    if (group.length === 0) {
        sendError(ws, '群聊不存在');
        return;
    }
    
    // 检查是否已是成员
    const [existingMember] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ? AND user_wx = ?', [group_id, my_wx_account]);
    
    // ✅ 截断过长的 avatar（防止超出TEXT限制）
    let characterAvatar = my_character?.avatar || null;
    if (characterAvatar && characterAvatar.length > 65000) {
        console.log(`[加入群聊] 角色头像过长(${characterAvatar.length}字符)，将被截断`);
        characterAvatar = characterAvatar.substring(0, 65000);
    }
    
    if (existingMember.length > 0) {
        // 已经是成员，更新角色信息
        if (my_character) {
            await db.execute(
                'UPDATE online_group_members SET character_name = ?, character_avatar = ?, character_desc = ? WHERE group_id = ? AND user_wx = ?',
                [my_character.name, characterAvatar, my_character.desc, group_id, my_wx_account]
            );
        }
    } else {
        // 添加为新成员
        const memberId = uuidv4();
        await db.execute(
            'INSERT INTO online_group_members (id, group_id, user_wx, character_name, character_avatar, character_desc, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [memberId, group_id, my_wx_account, my_character?.name || null, characterAvatar, my_character?.desc || null, Date.now()]
        );
    }
    
    // 获取加入者信息
    const [joinerChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [my_wx_account]);
    
    // 通知所有群成员
    const [members] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ?', [group_id]);
    members.forEach(m => {
        const memberSocket = wxAccountToSocket.get(m.user_wx);
        if (memberSocket) {
            send(memberSocket, {
                type: 'group_member_joined',
                group_id: group_id,
                member: {
                    user_wx: my_wx_account,
                    user_name: joinerChar[0]?.nickname || my_wx_account,
                    user_avatar: joinerChar[0]?.avatar || '',
                    character_name: my_character?.name || null,
                    character_avatar: my_character?.avatar || null
                }
            });
        }
    });
    
    // 发送加入成功消息给自己
    send(ws, {
        type: 'online_group_joined',
        group: {
            id: group_id,
            name: group[0].name,
            creator_wx: group[0].creator_wx,
            created_at: group[0].created_at
        }
    });
    
    console.log(`[群聊] ${my_wx_account} 加入群 ${group[0].name}`);
}

// 获取我的联机群聊列表
async function handleGetOnlineGroups(ws, data) {
    const clientData = clients.get(ws);
    const { my_wx_account } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    const [groups] = await db.execute(`
        SELECT g.* FROM online_groups g
        INNER JOIN online_group_members m ON g.id = m.group_id
        WHERE m.user_wx = ?
    `, [my_wx_account]);
    
    send(ws, {
        type: 'online_groups_list',
        groups: groups.map(g => ({
            id: g.id,
            name: g.name,
            creator_wx: g.creator_wx,
            created_at: g.created_at
        }))
    });
}

// 获取群聊消息记录
async function handleGetGroupMessages(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, limit, since } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查是否是群成员
    const [member] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ? AND user_wx = ?', [group_id, my_wx_account]);
    if (member.length === 0) {
        sendError(ws, '你不是该群的成员');
        return;
    }
    
    let messages;
    if (since) {
        [messages] = await db.execute('SELECT * FROM online_group_messages WHERE group_id = ? AND created_at > ? ORDER BY created_at ASC', [group_id, since]);
    } else if (limit) {
        // ✅ MySQL 预处理语句不支持 LIMIT 占位符，需要直接拼接
        const limitValue = parseInt(limit) || 100;
        [messages] = await db.execute(`SELECT * FROM online_group_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT ${limitValue}`, [group_id]);
        messages.reverse();
    } else {
        [messages] = await db.execute('SELECT * FROM online_group_messages WHERE group_id = ? ORDER BY created_at ASC', [group_id]);
    }
    
    // 为每条消息补充头像信息
    const [members] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ?', [group_id]);
    const memberMap = {};
    members.forEach(m => {
        memberMap[m.user_wx] = m;
    });
    
    const messagesWithAvatar = [];
    for (const msg of messages) {
        if (msg.sender_type === 'system') {
            messagesWithAvatar.push(msg);
            continue;
        }
        
        // 获取发送者信息
        const [senderChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [msg.sender_wx]);
        const memberInfo = memberMap[msg.sender_wx];
        
        messagesWithAvatar.push({
            ...msg,
            sender_avatar: senderChar[0]?.avatar || '',
            character_avatar: msg.sender_type === 'character' ? (memberInfo?.character_avatar || '') : null
        });
    }
    
    send(ws, {
        type: 'group_messages',
        group_id: group_id,
        messages: messagesWithAvatar
    });
}

// 发送群聊消息
async function handleSendGroupMessage(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, sender_type, sender_name, character_name, content, msg_type } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查是否是群成员
    const [member] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ? AND user_wx = ?', [group_id, my_wx_account]);
    if (member.length === 0) {
        sendError(ws, '你不是该群的成员');
        return;
    }
    
    // 如果是角色发的消息，验证是否是该用户的角色
    if (sender_type === 'character' && character_name !== member[0].character_name) {
        sendError(ws, '你只能使用自己带入群的角色发言');
        return;
    }
    
    // 保存消息
    const msgId = uuidv4();
    await db.execute(
        'INSERT INTO online_group_messages (id, group_id, sender_type, sender_wx, sender_name, character_name, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [msgId, group_id, sender_type || 'user', my_wx_account, sender_name, character_name || null, content, msg_type || 'text', Date.now()]
    );
    
    // 获取发送者头像
    const [senderChar] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [my_wx_account]);
    
    // 广播给所有群成员
    const [members] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ?', [group_id]);
    const msgData = {
        type: 'group_message',
        group_id: group_id,
        message: {
            id: msgId,
            sender_type: sender_type || 'user',
            sender_wx: my_wx_account,
            sender_name: sender_name,
            sender_avatar: senderChar[0]?.avatar || '',
            character_name: character_name || null,
            character_avatar: sender_type === 'character' ? member[0].character_avatar : null,
            content: content,
            msg_type: msg_type || 'text',
            created_at: Date.now()
        }
    };
    
    members.forEach(m => {
        const memberSocket = wxAccountToSocket.get(m.user_wx);
        if (memberSocket) {
            send(memberSocket, msgData);
        }
    });
    
    console.log(`[群消息] ${sender_type === 'character' ? character_name : sender_name} in ${group_id}: ${content.substring(0, 30)}...`);
}

// 处理群聊"正在输入"状态开始
async function handleGroupTypingStart(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, character_name } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        return;
    }
    
    // 检查是否是群成员
    const [member] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ? AND user_wx = ?', [group_id, my_wx_account]);
    if (member.length === 0) {
        return;
    }
    
    // 广播给群里的其他成员（除了自己）
    const [members] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ?', [group_id]);
    members.forEach(m => {
        if (m.user_wx !== my_wx_account) { // 不发给自己
            const memberSocket = wxAccountToSocket.get(m.user_wx);
            if (memberSocket) {
                send(memberSocket, {
                    type: 'group_typing_start',
                    group_id: group_id,
                    character_name: character_name,
                    user_wx: my_wx_account
                });
            }
        }
    });
    
    console.log(`[群聊] ${character_name} 开始输入 (群: ${group_id})`);
}

// 处理群聊"正在输入"状态结束
async function handleGroupTypingStop(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        return;
    }
    
    // 检查是否是群成员
    const [member] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ? AND user_wx = ?', [group_id, my_wx_account]);
    if (member.length === 0) {
        return;
    }
    
    // 广播给群里的其他成员（除了自己）
    const [members] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ?', [group_id]);
    members.forEach(m => {
        if (m.user_wx !== my_wx_account) { // 不发给自己
            const memberSocket = wxAccountToSocket.get(m.user_wx);
            if (memberSocket) {
                send(memberSocket, {
                    type: 'group_typing_stop',
                    group_id: group_id,
                    user_wx: my_wx_account
                });
            }
        }
    });
    
    console.log(`[群聊] 输入结束 (群: ${group_id}, 用户: ${my_wx_account})`);
}

// 获取群成员列表
async function handleGetGroupMembers(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account } = data;
    
    console.log('[获取群成员] 请求:', { group_id, my_wx_account });
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    let member, members;
    try {
        // 检查是否是群成员
        console.log('[获取群成员] 查询成员:', { group_id, my_wx_account });
        [member] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ? AND user_wx = ?', [group_id, my_wx_account]);
        if (member.length === 0) {
            sendError(ws, '你不是该群的成员');
            return;
        }
        
        console.log('[获取群成员] 查询所有成员:', { group_id });
        [members] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ?', [group_id]);
        console.log('[获取群成员] 查询成功，成员数:', members.length);
    } catch (queryError) {
        console.error('[获取群成员] 查询失败:', queryError.message);
        console.error('[获取群成员] 完整错误:', queryError);
        
        if (queryError.message.includes('Incorrect arguments')) {
            console.error('[获取群成员] 表结构错误，正在修复...');
            // 重建表
            await db.execute('DROP TABLE IF EXISTS online_group_messages');
            await db.execute('DROP TABLE IF EXISTS online_group_members');
            
            await db.execute(`
                CREATE TABLE online_group_members (
                    id VARCHAR(36) PRIMARY KEY,
                    group_id VARCHAR(36) NOT NULL,
                    user_wx VARCHAR(100) NOT NULL,
                    character_name VARCHAR(100),
                    character_avatar TEXT,
                    character_desc TEXT,
                    joined_at BIGINT DEFAULT 0,
                    UNIQUE KEY unique_group_member (group_id, user_wx),
                    INDEX idx_online_group_members_group (group_id),
                    FOREIGN KEY (group_id) REFERENCES online_groups(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            
            await db.execute(`
                CREATE TABLE online_group_messages (
                    id VARCHAR(36) PRIMARY KEY,
                    group_id VARCHAR(36) NOT NULL,
                    sender_type VARCHAR(20) NOT NULL,
                    sender_wx VARCHAR(100) NOT NULL,
                    sender_name VARCHAR(100) NOT NULL,
                    character_name VARCHAR(100),
                    content LONGTEXT NOT NULL,
                    msg_type VARCHAR(20) DEFAULT 'text',
                    created_at BIGINT DEFAULT 0,
                    INDEX idx_online_group_messages_group (group_id),
                    FOREIGN KEY (group_id) REFERENCES online_groups(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            
            sendError(ws, '表结构已修复，请重新创建群聊');
            return;
        }
        throw queryError;
    }
    
    // 获取每个成员的在线状态和昵称
    const membersWithInfo = [];
    for (const m of members) {
        const [charInfo] = await db.execute('SELECT * FROM online_characters WHERE wx_account = ?', [m.user_wx]);
        membersWithInfo.push({
            user_wx: m.user_wx,
            user_name: charInfo[0]?.nickname || m.user_wx,
            user_avatar: charInfo[0]?.avatar || '',
            is_online: charInfo[0]?.is_online === 1,
            character_name: m.character_name,
            character_avatar: m.character_avatar,
            character_desc: m.character_desc
        });
    }
    
    send(ws, {
        type: 'group_members',
        group_id: group_id,
        members: membersWithInfo
    });
}

// 更新群内角色
async function handleUpdateGroupCharacter(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, character } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查是否是群成员
    const [member] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ? AND user_wx = ?', [group_id, my_wx_account]);
    if (member.length === 0) {
        sendError(ws, '你不是该群的成员');
        return;
    }
    
    // ✅ 截断过长的 avatar（防止超出TEXT限制）
    let characterAvatar = character?.avatar || null;
    if (characterAvatar && characterAvatar.length > 65000) {
        console.log(`[更新群角色] 角色头像过长(${characterAvatar.length}字符)，将被截断`);
        characterAvatar = characterAvatar.substring(0, 65000);
    }
    
    // 更新角色信息
    await db.execute(
        'UPDATE online_group_members SET character_name = ?, character_avatar = ?, character_desc = ? WHERE group_id = ? AND user_wx = ?',
        [character?.name || null, characterAvatar, character?.desc || null, group_id, my_wx_account]
    );
    
    send(ws, {
        type: 'group_character_updated',
        group_id: group_id,
        character: character
    });
    
    console.log(`[群聊] ${my_wx_account} 更新群 ${group_id} 的角色为 ${character?.name || '无'}`);
}

// 领取群聊红包
async function handleClaimGroupRedPacket(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, message_id, claimer_name } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查是否是群成员
    const [member] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ? AND user_wx = ?', [group_id, my_wx_account]);
    if (member.length === 0) {
        sendError(ws, '你不是该群的成员');
        return;
    }
    
    // 查询消息
    const [messages] = await db.execute('SELECT * FROM online_group_messages WHERE group_id = ? AND id = ?', [group_id, message_id]);
    if (messages.length === 0 || messages[0].msg_type !== 'redpacket') {
        sendError(ws, '红包不存在');
        return;
    }
    
    const msg = messages[0];
    let redpacketData;
    try {
        redpacketData = JSON.parse(msg.content);
    } catch(e) {
        sendError(ws, '红包数据错误');
        return;
    }
    
    // 初始化数据结构
    if (!redpacketData.claimed) redpacketData.claimed = [];
    if (!redpacketData.claimedAmounts) redpacketData.claimedAmounts = {};
    
    // 检查是否已领取过
    if (redpacketData.claimed.includes(my_wx_account)) {
        sendError(ws, '你已领取过该红包');
        return;
    }
    
    // 检查是否已领完
    const claimedCount = redpacketData.claimed.length;
    if (claimedCount >= redpacketData.count) {
        sendError(ws, '红包已被领完');
        return;
    }
    
    // 计算领取金额
    const totalAmount = parseFloat(redpacketData.totalAmount);
    const remaining = redpacketData.count - claimedCount;
    const alreadyClaimed = Object.values(redpacketData.claimedAmounts).reduce((a, b) => a + parseFloat(b), 0);
    const remainingAmount = totalAmount - alreadyClaimed;
    
    let claimAmount = 0;
    if (redpacketData.redpacketType === 'lucky') {
        // 拼手气红包
        if (remaining === 1) {
            claimAmount = remainingAmount;
        } else {
            const maxAmount = remainingAmount - (remaining - 1) * 0.01;
            claimAmount = Math.random() * maxAmount * 0.8 + 0.01;
            claimAmount = Math.min(claimAmount, maxAmount);
        }
    } else {
        // 普通红包：剩余金额平均分
        claimAmount = remainingAmount / remaining;
    }
    
    claimAmount = parseFloat(claimAmount.toFixed(2));
    
    // 验证金额不超过剩余金额
    if (claimAmount > remainingAmount || claimAmount <= 0) {
        sendError(ws, '红包金额异常');
        console.error('[红包] 金额异常:', { claimAmount, remainingAmount, totalAmount, alreadyClaimed });
        return;
    }
    
    // 更新红包数据
    redpacketData.claimed.push(my_wx_account);
    redpacketData.claimedAmounts[my_wx_account] = claimAmount.toFixed(2);
    
    // 更新数据库中的消息
    await db.execute('UPDATE online_group_messages SET content = ? WHERE id = ?', [JSON.stringify(redpacketData), message_id]);
    
    // 广播系统消息
    const [members] = await db.execute('SELECT * FROM online_group_members WHERE group_id = ?', [group_id]);
    const systemMsg = {
        type: 'group_message',
        group_id: group_id,
        message: {
            id: uuidv4(),
            sender_type: 'system',
            sender_wx: 'system',
            sender_name: '系统',
            content: `${claimer_name || my_wx_account} 领取了红包，获得 ¥${claimAmount.toFixed(2)}`,
            msg_type: 'system',
            created_at: Date.now()
        }
    };
    
    members.forEach(m => {
        const memberSocket = wxAccountToSocket.get(m.user_wx);
        if (memberSocket) {
            send(memberSocket, systemMsg);
        }
    });
    
    // 广播红包状态更新
    const updateMsg = {
        type: 'redpacket_claimed',
        group_id: group_id,
        message_id: message_id,
        claimer_wx: my_wx_account,
        claim_amount: claimAmount.toFixed(2),
        redpacket_data: redpacketData
    };
    
    members.forEach(m => {
        const memberSocket = wxAccountToSocket.get(m.user_wx);
        if (memberSocket) {
            send(memberSocket, updateMsg);
        }
    });
    
    console.log(`[红包] ${my_wx_account} 领取红包 ${message_id}，获得 ¥${claimAmount.toFixed(2)}`);
}

// ==================== 联机群聊功能结束 ====================

// 启动服务器
async function startServer() {
    try {
        // 先初始化数据库
        await initDB();
        
        // 初始化激活码模块（创建表 + 绑定 API 路由）
        await activation.init(db);
        activation.bindRoutes(server, db);
        
        // 再启动 HTTP + WebSocket 服务
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 联机服务器已启动，端口: ${PORT}`);
            console.log(`🔗 WebSocket 地址: ws://localhost:${PORT}`);
            console.log(`🔗 健康检查: http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ 服务器启动失败:', error);
        process.exit(1);
    }
}

// 优雅关闭
process.on('SIGINT', async () => {
    console.log('\n正在关闭服务器...');
    
    // 将所有角色设为离线
    await db.execute('UPDATE online_characters SET is_online = 0');
    
    // 关闭 WebSocket 服务器
    wss.close();
    
    // 关闭 HTTP 服务器
    server.close(async () => {
        // 关闭数据库连接池
        await db.end();
        console.log('服务器已关闭');
        process.exit(0);
    });
});

// 启动
startServer();
