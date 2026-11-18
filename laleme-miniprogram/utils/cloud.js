// 云端连接层：唯一的网络出口。
// 生产走微信云托管的 wx.cloud.callContainer（免域名、免鉴权，平台注入 openid）；
// 本地联调用 http 模式直连 127.0.0.1，方便在开发者工具里跑通全链路。

const CFG_KEY = 'laleme_cloud';

const DEFAULTS = {
    enabled: false,
    mode: 'container',      // container | http
    env: '',                // 云托管环境 ID
    service: 'laleme-server',
    baseUrl: '',            // http 模式下的地址，如 http://127.0.0.1:3100
    debugOpenid: '',        // http 模式下的假身份，仅开发用
    token: '',              // 服务端签发的登录令牌
    lastSync: 0,
    cursor: 0,
};

function readConfig() {
    const raw = wx.getStorageSync(CFG_KEY);
    return Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
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
