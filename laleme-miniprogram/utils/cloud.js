// 云端连接层：唯一的网络出口。
// 生产：https 直连 api.laleme.ariel.today（自建 Node + nginx）。
// 另外保留 container 模式（微信云托管）与 http 模式（本地联调）作为备选。

const CFG_KEY = 'laleme_cloud';

const DEFAULTS = {
    enabled: false,
    mode: 'http',           // http（自建服务器）| container（微信云托管）
    env: '',                // 云托管环境 ID
    service: 'laleme-server',
    baseUrl: 'https://api.laleme.ariel.today',
    debugOpenid: '',        // http 模式下的假身份，仅开发用
    token: '',              // 服务端签发的登录令牌
    lastSync: 0,
    cursor: 0,
};

// 旧版曾用 http://8.153.164.6 直连联调，这些设备要迁到正式域名，
// 否则升级后仍然打 IP，域名校验与证书都用不上。
const LEGACY_HOSTS = ['http://8.153.164.6', 'http://127.0.0.1:3100'];

function readConfig() {
    const raw = wx.getStorageSync(CFG_KEY);
    const cfg = Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    if (cfg.baseUrl && LEGACY_HOSTS.some(function (h) { return cfg.baseUrl.indexOf(h) === 0; })) {
        cfg.baseUrl = DEFAULTS.baseUrl;
        cfg.mode = DEFAULTS.mode;
        try {
            wx.setStorageSync(CFG_KEY, Object.assign({}, raw, { baseUrl: cfg.baseUrl, mode: cfg.mode }));
        } catch (e) {
            // 存储不可用时只影响本次，不阻断
        }
    }
    return cfg;
}

function writeConfig(patch) {
    const next = Object.assign(readConfig(), patch || {});
    wx.setStorageSync(CFG_KEY, next);
    return next;
}

let inited = false;

function initCloud() {
    const cfg = readConfig();
    if (cfg.mode === 'container' && !inited && cfg.env && wx.cloud) {
        wx.cloud.init({ env: cfg.env, traceUser: false });
        inited = true;
    }
}

function authHeader(cfg) {
    const header = { 'content-type': 'application/json' };
    if (cfg.token) {
        header.Authorization = 'Bearer ' + cfg.token;
    }
    return header;
}

function requestHttp(path, method, data) {
    const cfg = readConfig();
    const header = authHeader(cfg);
    if (!cfg.token && cfg.debugOpenid) {
        header['x-debug-openid'] = cfg.debugOpenid;
    }
    return new Promise(function (resolve, reject) {
        wx.request({
            url: cfg.baseUrl + path,
            method: method,
            data: data,
            header: header,
            success: function (res) {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(res.data);
                } else {
                    reject(new Error((res.data && res.data.error && res.data.error.message) || '请求失败'));
                }
            },
            fail: function (err) {
                reject(new Error(err.errMsg || '网络异常'));
            },
        });
    });
}

function requestContainer(path, method, data) {
    initCloud();
    const cfg = readConfig();
    return new Promise(function (resolve, reject) {
        wx.cloud.callContainer({
            config: { env: cfg.env },
            path: path,
            method: method,
            header: Object.assign({ 'X-WX-SERVICE': cfg.service }, authHeader(cfg)),
            data: data || {},
            success: function (res) {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(res.data);
                } else {
                    reject(new Error((res.data && res.data.error && res.data.error.message) || '请求失败'));
                }
            },
            fail: function (err) {
                reject(new Error(err.errMsg || '云托管不可用'));
            },
        });
    });
}

function call(path, method, data) {
    return readConfig().mode === 'http'
        ? requestHttp(path, method, data)
        : requestContainer(path, method, data);
}

// 登录：wx.login 拿 code → 服务端换 openid 并下发令牌
function login(profile) {
    return new Promise(function (resolve, reject) {
        wx.login({
            success(res) {
                if (!res.code) {
                    reject(new Error('微信登录失败，请重试'));
                    return;
                }
                call('/api/login', 'POST', Object.assign({ code: res.code }, profile || {}))
                    .then(function (data) {
                        writeConfig({ token: data.token });
                        resolve(data);
                    })
                    .catch(reject);
            },
            fail() {
                reject(new Error('微信登录失败，请重试'));
            },
        });
    });
}

// 静默登录：只换 openid 拿令牌，不上传任何记录（提醒功能只需要它）
function ensureToken() {
    const cfg = readConfig();
    if (cfg.token) {
        return Promise.resolve(cfg.token);
    }
    return login({}).then(function (res) {
        return res.token;
    });
}

module.exports = {
    login: login,
    ensureToken: ensureToken,
    CFG_KEY: CFG_KEY,
    readConfig: readConfig,
    writeConfig: writeConfig,
    call: call,
    initCloud: initCloud,
};
