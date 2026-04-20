/**
 * 激活码后端模块（独立文件）
 * 
 * 功能：
 * 1. 自动创建 activation_codes 数据表
 * 2. 提供 HTTP API：验证激活码、生成激活码、查询激活码
 * 3. 供 QQ 机器人插件远程调用生成激活码
 * 
 * 使用方式：在 server.js 中引入并初始化
 *   const activation = require('./activation-server');
 *   activation.init(db);                    // 传入数据库连接池，创建表
 *   activation.bindRoutes(server, db);      // 绑定到已有 HTTP 服务器（不会影响 WebSocket）
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ==================== 配置 ====================
// API 密钥：QQ 机器人调用生成接口时需要携带此密钥
// 生产环境请通过环境变量 ACTIVATION_API_KEY 设置
const API_KEY = process.env.ACTIVATION_API_KEY || 'change-this-secret-key';

// 激活码有效期（毫秒），默认 365 天，0 = 永不过期
const CODE_EXPIRE_MS = parseInt(process.env.ACTIVATION_EXPIRE_DAYS || '365') * 24 * 60 * 60 * 1000;

// ==================== 数据库初始化 ====================

/**
 * 初始化激活码数据表
 * @param {import('mysql2/promise').Pool} db MySQL 连接池
 */
async function init(db) {
    console.log('🔑 正在创建激活码数据表...');
    
    await db.execute(`
        CREATE TABLE IF NOT EXISTS activation_codes (
            id VARCHAR(36) PRIMARY KEY,
            code VARCHAR(32) UNIQUE NOT NULL COMMENT '激活码（16位大写字母+数字）',
            qq_number VARCHAR(20) COMMENT '获取该激活码的QQ号',
            status VARCHAR(20) DEFAULT 'unused' COMMENT 'unused=未使用, used=已使用, disabled=已禁用',
            used_at BIGINT DEFAULT NULL COMMENT '激活时间戳',
            used_device VARCHAR(255) DEFAULT NULL COMMENT '激活时的设备指纹（浏览器UA摘要）',
            created_at BIGINT DEFAULT 0 COMMENT '创建时间戳',
            expires_at BIGINT DEFAULT 0 COMMENT '过期时间戳，0=永不过期',
            INDEX idx_activation_code (code),
            INDEX idx_activation_qq (qq_number),
            INDEX idx_activation_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    const [count] = await db.execute('SELECT COUNT(*) as total FROM activation_codes');
    console.log(`✅ 激活码表就绪（已有 ${count[0].total} 条记录）`);
}

// ==================== 工具函数 ====================

/**
 * 生成一个 16 位随机激活码（大写字母 + 数字，格式 XXXX-XXXX-XXXX-XXXX）
 */
function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易混淆的 I/O/0/1
    let code = '';
    const bytes = crypto.randomBytes(16);
    for (let i = 0; i < 16; i++) {
        code += chars[bytes[i] % chars.length];
    }
    // 格式化为 XXXX-XXXX-XXXX-XXXX
    return code.replace(/(.{4})/g, '$1-').slice(0, 19);
}

/**
 * 解析请求体 JSON
 */
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('JSON 解析失败'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * 发送 JSON 响应
 */
function jsonResponse(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
    });
    res.end(JSON.stringify(data));
}

// ==================== 路由处理 ====================

/**
 * 将激活码 API 路由绑定到现有的 HTTP 服务器
 * 不会影响原有的 WebSocket 和健康检查
 * 
 * @param {http.Server} httpServer  已有的 HTTP 服务器实例
 * @param {import('mysql2/promise').Pool} db MySQL 连接池
 */
function bindRoutes(httpServer, db) {
    // 保存原来的 request 监听器
    const originalListeners = httpServer.listeners('request').slice();
    httpServer.removeAllListeners('request');
    
    httpServer.on('request', async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;
        
        // ---- CORS 预检 ----
        if (req.method === 'OPTIONS' && pathname.startsWith('/api/activation')) {
            jsonResponse(res, 200, { ok: true });
            return;
        }
        
        // ---- POST /api/activation/verify  前端验证激活码 ----
        if (req.method === 'POST' && pathname === '/api/activation/verify') {
            try {
                const body = await parseBody(req);
                const { code, device } = body;
                
                if (!code) {
                    jsonResponse(res, 400, { success: false, message: '请输入激活码' });
                    return;
                }
                
                // 标准化激活码格式（去空格、转大写、补横杠）
                const cleanCode = code.replace(/[\s-]/g, '').toUpperCase();
                const formattedCode = cleanCode.replace(/(.{4})/g, '$1-').slice(0, 19);
                
                // 查询激活码
                const [rows] = await db.execute(
                    'SELECT * FROM activation_codes WHERE code = ?',
                    [formattedCode]
                );
                
                if (rows.length === 0) {
                    jsonResponse(res, 200, { success: false, message: '激活码不存在' });
                    return;
                }
                
                const record = rows[0];
                
                // 检查是否被禁用
                if (record.status === 'disabled') {
                    jsonResponse(res, 200, { success: false, message: '该激活码已被禁用' });
                    return;
                }
                
                // 检查是否过期
                if (record.expires_at > 0 && Date.now() > record.expires_at) {
                    jsonResponse(res, 200, { success: false, message: '该激活码已过期' });
                    return;
                }
                
                // 如果已使用 —— 只允许同一设备重复验证（刷新页面）
                if (record.status === 'used') {
                    // 检查是否被新码替代
                    const [newer] = await db.execute(
                        'SELECT id FROM activation_codes WHERE qq_number = ? AND created_at > ? AND status != ?',
                        [record.qq_number, record.created_at, 'disabled']
                    );
                    
                    if (newer.length > 0) {
                        jsonResponse(res, 200, {
                            success: false,
                            message: '该激活码已失效，请使用最新的激活码'
                        });
                        return;
                    }
                    
                    // 检查是否是同一设备（允许同一设备刷新页面后重新验证）
                    // 必须要求设备指纹存在且完全匹配
                    if (!device || !device.trim()) {
                        jsonResponse(res, 200, {
                            success: false,
                            message: '设备信息缺失，无法验证'
                        });
                        return;
                    }
                    
                    const storedDevice = record.used_device ? record.used_device.trim() : '';
                    const currentDevice = device.trim();
                    
                    // 精确匹配：完全相同的设备指纹
                    if (storedDevice === currentDevice) {
                        jsonResponse(res, 200, {
                            success: true,
                            message: '激活码有效',
                            qq: record.qq_number || null
                        });
                        return;
                    }
                    
                    // 兼容旧格式：如果存储的是旧格式（只有User-Agent），且当前也是旧格式，允许匹配
                    // 旧格式通常是纯User-Agent，长度较短（<200字符），且不包含UUID
                    const isOldFormat = storedDevice.length < 200 && !storedDevice.includes('-') && storedDevice === currentDevice;
                    if (isOldFormat) {
                        jsonResponse(res, 200, {
                            success: true,
                            message: '激活码有效',
                            qq: record.qq_number || null
                        });
                        return;
                    }
                    
                    // 不是同一设备，拒绝
                    jsonResponse(res, 200, {
                        success: false,
                        message: '该激活码已在其他设备上使用，请获取新的激活码'
                    });
                    return;
                }
                
                // 首次激活：标记为已使用，记录设备指纹
                // 必须要求设备指纹存在
                if (!device || !device.trim()) {
                    jsonResponse(res, 200, {
                        success: false,
                        message: '设备信息缺失，无法激活'
                    });
                    return;
                }
                
                const deviceFingerprint = device.trim();
                
                // 安全检查：防止设备指纹被恶意修改
                // 新格式应该包含UUID（包含连字符），旧格式应该较短
                const isValidFormat = deviceFingerprint.length > 10 && deviceFingerprint.length <= 255;
                if (!isValidFormat) {
                    jsonResponse(res, 200, {
                        success: false,
                        message: '设备信息格式无效'
                    });
                    return;
                }
                
                await db.execute(
                    'UPDATE activation_codes SET status = ?, used_at = ?, used_device = ? WHERE id = ?',
                    ['used', Date.now(), deviceFingerprint, record.id]
                );
                
                console.log(`🔑 激活码已使用: ${formattedCode} (QQ: ${record.qq_number || '未知'})`);
                
                jsonResponse(res, 200, {
                    success: true,
                    message: '激活成功！',
                    qq: record.qq_number || null
                });
                
            } catch (error) {
                console.error('[激活码验证错误]', error);
                jsonResponse(res, 500, { success: false, message: '服务器错误' });
            }
            return;
        }
        
        // ---- POST /api/activation/generate  QQ机器人调用：生成激活码 ----
        if (req.method === 'POST' && pathname === '/api/activation/generate') {
            try {
                // 验证 API 密钥
                const apiKey = req.headers['x-api-key'] || '';
                if (apiKey !== API_KEY) {
                    jsonResponse(res, 403, { success: false, message: 'API 密钥无效' });
                    return;
                }
                
                const body = await parseBody(req);
                const { qq_number } = body;
                
                if (!qq_number) {
                    jsonResponse(res, 400, { success: false, message: '缺少 qq_number 参数' });
                    return;
                }
                
                // ★ 把该QQ号的所有旧激活码全部禁用（无论 unused 还是 used）
                await db.execute(
                    'UPDATE activation_codes SET status = ? WHERE qq_number = ? AND status != ?',
                    ['disabled', String(qq_number), 'disabled']
                );
                
                console.log(`🔑 已禁用 QQ ${qq_number} 的所有旧激活码`);
                
                // 生成新激活码
                const code = generateCode();
                const id = uuidv4();
                const now = Date.now();
                const expiresAt = CODE_EXPIRE_MS > 0 ? now + CODE_EXPIRE_MS : 0;
                
                await db.execute(
                    'INSERT INTO activation_codes (id, code, qq_number, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
                    [id, code, String(qq_number), 'unused', now, expiresAt]
                );
                
                console.log(`🔑 新激活码生成: ${code} → QQ ${qq_number}`);
                
                jsonResponse(res, 200, {
                    success: true,
                    code: code,
                    message: '激活码生成成功',
                    already_exists: false,
                    expires_at: expiresAt
                });
                
            } catch (error) {
                console.error('[生成激活码错误]', error);
                jsonResponse(res, 500, { success: false, message: '服务器错误' });
            }
            return;
        }
        
        // ---- GET /api/activation/check?qq=xxx  查询某QQ号的激活码状态 ----
        if (req.method === 'GET' && pathname === '/api/activation/check') {
            try {
                const apiKey = req.headers['x-api-key'] || url.searchParams.get('key') || '';
                if (apiKey !== API_KEY) {
                    jsonResponse(res, 403, { success: false, message: 'API 密钥无效' });
                    return;
                }
                
                const qq = url.searchParams.get('qq');
                if (!qq) {
                    jsonResponse(res, 400, { success: false, message: '缺少 qq 参数' });
                    return;
                }
                
                const [rows] = await db.execute(
                    'SELECT code, status, created_at, expires_at, used_at FROM activation_codes WHERE qq_number = ? ORDER BY created_at DESC',
                    [String(qq)]
                );
                
                jsonResponse(res, 200, {
                    success: true,
                    qq: qq,
                    codes: rows
                });
                
            } catch (error) {
                console.error('[查询激活码错误]', error);
                jsonResponse(res, 500, { success: false, message: '服务器错误' });
            }
            return;
        }
        
        // ---- POST /api/activation/disable  QQ机器人调用：禁用某QQ号的所有激活码（退群时调用） ----
        if (req.method === 'POST' && pathname === '/api/activation/disable') {
            try {
                const apiKey = req.headers['x-api-key'] || '';
                if (apiKey !== API_KEY) {
                    jsonResponse(res, 403, { success: false, message: 'API 密钥无效' });
                    return;
                }
                
                const body = await parseBody(req);
                const { qq_number } = body;
                
                if (!qq_number) {
                    jsonResponse(res, 400, { success: false, message: '缺少 qq_number 参数' });
                    return;
                }
                
                // 把该QQ号的所有激活码全部禁用
                const [result] = await db.execute(
                    'UPDATE activation_codes SET status = ? WHERE qq_number = ? AND status != ?',
                    ['disabled', String(qq_number), 'disabled']
                );
                
                console.log(`🔑 退群禁用: QQ ${qq_number} 的 ${result.affectedRows} 个激活码已禁用`);
                
                jsonResponse(res, 200, {
                    success: true,
                    message: `已禁用 ${result.affectedRows} 个激活码`,
                    disabled_count: result.affectedRows
                });
                
            } catch (error) {
                console.error('[禁用激活码错误]', error);
                jsonResponse(res, 500, { success: false, message: '服务器错误' });
            }
            return;
        }
        
        // ---- 不是激活码相关的请求，交给原来的处理器 ----
        for (const listener of originalListeners) {
            listener.call(httpServer, req, res);
        }
    });
    
    console.log('🔑 激活码 API 路由已绑定:');
    console.log('   POST /api/activation/verify    - 前端验证激活码');
    console.log('   POST /api/activation/generate   - QQ机器人生成激活码');
    console.log('   GET  /api/activation/check      - 查询QQ号激活码状态');
    console.log('   POST /api/activation/disable    - 禁用某QQ号所有激活码（退群）');
}

module.exports = { init, bindRoutes, generateCode };

