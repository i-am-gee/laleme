// 触感反馈：统一入口，避免各页面散落 wx.vibrateShort 调用
// 强度分档：light（选项切换）< tap（普通按钮）< strong（主操作 / 危险操作）
// 微信 vibrateShort 的 type 仅 iOS 生效，Android 会走默认强度，因此做降级链

let enabled = true;

function tryShort(type) {
    wx.vibrateShort({
        type: type,
        fail: function () {
            if (type !== 'light') {
                wx.vibrateShort({ fail: function () {} });
            }
        },
    });
}

// 轻触：选项切换等非关键操作（medium，已比默认更明显）
function light() {
    if (!enabled) return;
    tryShort('medium');
}

// 标准点击：所有按钮的默认反馈，heavy 连续两下，体感强于单次
function tap() {
    if (!enabled) return;
    tryShort('heavy');
    setTimeout(function () {
        tryShort('heavy');
    }, 55);
}

// 最强：主操作 / 危险操作走 vibrateLong（设备允许的最长震动），
// 不支持时回退为三次 heavy 连击，保证「最强」的体感不落空
function strong() {
    if (!enabled) return;
    if (wx.vibrateLong) {
        wx.vibrateLong({
            fail: function () {
                burst();
            },
        });
        return;
    }
    burst();
}

function burst() {
    tryShort('heavy');
    setTimeout(function () { tryShort('heavy'); }, 55);
    setTimeout(function () { tryShort('heavy'); }, 110);
}

function setEnabled(value) {
    enabled = !!value;
}

module.exports = {
    light: light,
    tap: tap,
    strong: strong,
    setEnabled: setEnabled,
};
