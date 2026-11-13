// 触感反馈：统一入口，避免各页面散落 wx.vibrateShort 调用
// 微信 vibrateShort 的 type 仅 iOS 生效，Android 会走默认强度，因此做降级链

let enabled = true;

function tryShort(type) {
    wx.vibrateShort({
        type: type,
        fail: function () {
            // 低版本或不支持 type 参数时退回无参调用
            if (type !== 'light') {
                wx.vibrateShort({ fail: function () {} });
            }
        },
    });
}

// 轻触：用于选项切换、次级操作
function light() {
    if (!enabled) return;
    tryShort('light');
}

// 标准点击：所有按钮的默认反馈
function tap() {
    if (!enabled) return;
    tryShort('heavy');
}

// 强调：主操作 / 危险操作，双段震动，体感更强
function strong() {
    if (!enabled) return;
    tryShort('heavy');
    setTimeout(function () {
        tryShort('medium');
    }, 70);
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
