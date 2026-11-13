// 编辑记录页：表单本身在 components/record-form，与首页底部抽屉共用
Page({
    data: {
        recordId: '',
    },

    onLoad(options) {
        const id = options && options.id ? String(options.id) : '';
        this.setData({ recordId: id });
        if (id) {
            wx.setNavigationBarTitle({ title: '编辑记录' });
        } else {
            wx.setNavigationBarTitle({ title: '记一次' });
            // 新建模式：等表单组件就绪后开始计时
            this._pendingOpen = true;
        }
    },

    onReady() {
        if (this._pendingOpen) {
            this._pendingOpen = false;
            const form = this.selectComponent('#recordForm');
            if (form) {
                form.open();
            }
        }
    },

    onShow() {
        const form = this.selectComponent('#recordForm');
        if (form) {
            form.resume();
        }
    },

    onHide() {
        const form = this.selectComponent('#recordForm');
        if (form) {
            form.pause();
        }
    },

    onUnload() {
        const form = this.selectComponent('#recordForm');
        if (form) {
            form.close();
        }
    },

    onSaved() {
        setTimeout(function () {
            wx.navigateBack();
        }, 350);
    },

    onDeleted() {
        setTimeout(function () {
            wx.navigateBack();
        }, 350);
    },
});
