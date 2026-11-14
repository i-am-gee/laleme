// 自定义 tabBar：原生 tabBar 无法拦截点击，加不了震动反馈，所以自己画一条
const haptics = require('../utils/haptics.js');

const LIST = [
    { path: '/pages/index/index', text: '首页', icon: '/assets/tabbar/home.png', active: '/assets/tabbar/home-active.png' },
    { path: '/pages/history/history', text: '历史', icon: '/assets/tabbar/history.png', active: '/assets/tabbar/history-active.png' },
    { path: '/pages/stats/stats', text: '统计', icon: '/assets/tabbar/stats.png', active: '/assets/tabbar/stats-active.png' },
    { path: '/pages/me/me', text: '我的', icon: '/assets/tabbar/me.png', active: '/assets/tabbar/me-active.png' },
];

Component({
    data: {
        selected: 0,
        list: LIST,
        pressed: -1,
        // 庆祝动画盖住整页时，把 tabBar 一起压暗，避免它亮在最上层
        dim: false,
        // 庆祝动画盖住整页时，把 tabBar 一起压暗，避免它亮在最上层
        dim: false,
    },

    methods: {
        onTap(event) {
            const index = Number(event.currentTarget.dataset.index);
            if (index === this.data.selected) {
                haptics.tap();
                return;
            }
            haptics.tap();
            this.setData({ selected: index, pressed: index });
            setTimeout(() => {
                this.setData({ pressed: -1 });
            }, 180);
            wx.switchTab({
                url: LIST[index].path,
                fail: function () {},
            });
        },
    },
});
