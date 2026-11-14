/**
 * 自定义导航栏（iOS Large Title）所需的顶部安全距离
 * 返回 px 数值，用于页面内联 style 的 padding-top
 */
function getNavTop(extra) {
    const pad = typeof extra === 'number' ? extra : 10;
    try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const statusBarHeight = info.statusBarHeight || 20;
        let bottom = 0;
        if (wx.getMenuButtonBoundingClientRect) {
            const rect = wx.getMenuButtonBoundingClientRect();
            if (rect && rect.bottom > 0) {
                bottom = rect.bottom;
            }
        }
        if (!bottom) {
            bottom = statusBarHeight + 44;
        }
        return Math.round(bottom + pad);
    } catch (e) {
        return 72;
    }
}

module.exports = { getNavTop };
