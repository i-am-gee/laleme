// 喊好友挑战：首页与统计页共用
// 分享次数、称号状态都在 utils/share.js，这里只负责展示与点击
const share = require('../../utils/share.js');
const haptics = require('../../utils/haptics.js');

Component({
    data: {
        count: 0,
        left: share.SHARE_BADGE_TARGET,
        badge: false,
    },

    lifetimes: {
        attached() {
            this.sync();
        },
    },

    // 分享面板收起、页面回到前台时重新读一次进度
    pageLifetimes: {
        show() {
            this.sync();
        },
    },

    methods: {
        sync() {
            const count = share.shareCount();
            const badge = share.shareBadge();
            const left = Math.max(0, share.SHARE_BADGE_TARGET - count);
            if (count !== this.data.count || badge !== this.data.badge) {
                this.setData({ count: count, left: left, badge: badge });
            }
        },

        onTouch() {
            haptics.tap();
        },
    },
});
