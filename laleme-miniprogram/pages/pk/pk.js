const { getNavTop } = require('../../utils/nav.js');
const { createRecordStore } = require('../../utils/record-store.js');
const score = require('../../utils/pk/score.js');
const pk = require('../../utils/pk/api.js');
const haptics = require('../../utils/haptics.js');

const store = createRecordStore();

function initialOf(nick) {
    const s = String(nick || '').trim();
    return s ? s.slice(0, 1) : '💩';
}

// 一个维度怎么判胜负：次数与质量比大，时长比谁更接近理想值
function judge(key, mine, peer) {
    if (key === 'duration') {
        // 有一方完全没时长的样本时不做判定，避免把 null 当成 0 分算
        if (mine.avgMin === null || peer.avgMin === null) {
            return 'tie';
        }
        const a = Math.abs(Number(mine.avgMin) - score.IDEAL_MIN);
        const b = Math.abs(Number(peer.avgMin) - score.IDEAL_MIN);
        if (a === b) {
            return 'tie';
        }
        return a < b ? 'me' : 'peer';
    }
    if (key === 'quality') {
        if (mine.avgQuality === null || peer.avgQuality === null) {
            return 'tie';
        }
        if (mine.avgQuality === peer.avgQuality) {
            return 'tie';
        }
        return mine.avgQuality > peer.avgQuality ? 'me' : 'peer';
    }
    if (mine.count === peer.count) {
        return 'tie';
    }
    return mine.count > peer.count ? 'me' : 'peer';
}

Page({
    data: {
        navTop: 0,
        ready: false,
        mode: false,
        period: 'week',
        me: { nick: '', initial: '💩' },
        mine: { count: 0, minText: '—', qText: '—' },
        friends: [],
        activeId: '',
        active: { nick: '', initial: '', synced: false },
        rows: [],
        summary: '',
        inviteToken: '',
        rankRows: [],
        rankPartial: false,
    },

    onLoad() {
        this.setData({ navTop: getNavTop() });
        this.load();
    },

    onShow() {
        // 从邀请落地页回来时要重新拉一次关系
        if (this.data.ready) {
            this.load();
        }
    },

    load() {
        const that = this;
        const period = pk.periodOf(this.data.period);

        pk.getMode().then(function (on) {
            if (!on) {
                that.setData({ ready: true, mode: false });
                return null;
            }
            return Promise.all([pk.getProfile(), pk.createInvite(), pk.listFriends(), store.list()])
                .then(function (res) {
                    const profile = res[0];
                    const invite = res[1];
                    const friends = (res[2] || []).map(function (f) {
                        return { id: f.id, nick: f.nick, initial: initialOf(f.nick) };
                    });
                    const records = (res[3] && res[3].data) || [];
                    const mine = score.aggregate(records, period.since);

                    // 本地阶段的上报只是落盘留痕，云端版本会写 records 并返回权威分
                    pk.pushMyStats(period.stamp, mine);
                    that._mine = mine;

                    // 一份周期内一次性把所有好友的数据拉齐，排名才有意义
                    return Promise.all(friends.map(function (f) {
                        return pk.getPeerStats(f.id, period.stamp).catch(function () {
                            return null;
                        });
                    })).then(function (peers) {
                        const map = {};
                        friends.forEach(function (f, i) {
                            map[f.id] = peers[i] || null;
                        });
                        that._peers = map;

                        const keep = that.data.activeId;
                        const activeId = friends.length
                            ? (keep && map[keep] !== undefined ? keep : friends[0].id)
                            : '';

                        that.setData({
                            ready: true,
                            mode: true,
                            me: { nick: profile.nick, initial: initialOf(profile.nick) },
                            inviteToken: invite.token,
                            friends: friends,
                            activeId: activeId,
                            mine: {
                                count: mine.count,
                                minText: score.formatDuration(mine.avgMin),
                                qText: mine.avgQuality === null ? '—' : String(mine.avgQuality),
                            },
                        }, function () {
                            const active = friends.filter(function (f) {
                                return f.id === activeId;
                            })[0];
                            if (active) {
                                that.renderCompare(active, mine, map[active.id]);
                            } else {
                                that.setData({
                                    rows: [],
                                    summary: '',
                                    active: { nick: '', initial: '', synced: false },
                                });
                            }
                            that.renderRank(mine, profile.nick, friends, map);
                        });
                    });
                });
        }).catch(function () {
            that.setData({ ready: true });
        });
    },

    // 排名：参与的人按质量分降序，同分比次数
    renderRank(mine, myNick, friends, map) {
        const rows = [{
            id: 'me',
            nick: myNick,
            isMe: true,
            quality: mine.avgQuality,
            count: mine.count,
        }];
        friends.forEach(function (f) {
            const peer = map[f.id];
            if (peer) {
                rows.push({
                    id: f.id,
                    nick: f.nick,
                    isMe: false,
                    quality: peer.avgQuality === undefined ? null : peer.avgQuality,
                    count: peer.count || 0,
                });
            }
        });
        const sorted = rows.slice().sort(function (x, y) {
            const qx = x.quality === null ? -1 : x.quality;
            const qy = y.quality === null ? -1 : y.quality;
            if (qy !== qx) {
                return qy - qx;
            }
            return y.count - x.count;
        });
        this.setData({
            rankRows: sorted.map(function (r, i) {
                return {
                    id: r.id,
                    nick: r.nick,
                    isMe: r.isMe,
                    rank: i + 1,
                    qText: r.quality === null ? '—' : String(r.quality),
                    cText: r.count + ' 次',
                };
            }),
            rankPartial: sorted.length < 2,
        });
    },

    renderCompare(friend, mine, peer) {
        const has = !!peer;
        const rows = [
            {
                key: 'count',
                label: '记录次数',
                meText: String(mine.count),
                peerText: has ? String(peer.count) : '—',
                win: has ? judge('count', mine, peer) : '',
            },
            {
                key: 'duration',
                label: '平均时长',
                meText: score.formatDuration(mine.avgMin),
                peerText: has ? score.formatDuration(peer.avgMin) : '—',
                win: has ? judge('duration', mine, peer) : '',
            },
            {
                key: 'quality',
                label: '质量分',
                meText: mine.avgQuality === null ? '—' : String(mine.avgQuality),
                peerText: has && peer.avgQuality !== null ? String(peer.avgQuality) : '—',
                win: has ? judge('quality', mine, peer) : '',
            },
        ];

        let summary = '等待对方同步数据';
        if (has) {
            let w = 0;
            let l = 0;
            let t = 0;
            rows.forEach(function (r) {
                if (r.win === 'me') {
                    w += 1;
                } else if (r.win === 'peer') {
                    l += 1;
                } else if (r.win === 'tie') {
                    t += 1;
                }
            });
            summary = w + ' 胜 ' + l + ' 负' + (t ? ' ' + t + ' 平' : '');
        }

        this.setData({
            active: { nick: friend.nick, initial: friend.initial, synced: has },
            rows: rows,
            summary: summary,
        });
    },

    setPeriod(event) {
        const period = event.currentTarget.dataset.p;
        if (period === this.data.period) {
            return;
        }
        haptics.tap();
        this.setData({ period: period }, () => this.load());
    },

    selectFriend(event) {
        const id = event.currentTarget.dataset.id;
        if (id === this.data.activeId) {
            return;
        }
        haptics.tap();
        const that = this;
        const friend = this.data.friends.filter(function (f) { return f.id === id; })[0];
        this.setData({ activeId: id }, function () {
            if (friend) {
                that.renderCompare(friend, that._mine, (that._peers || {})[id] || null);
            }
        });
    },

    enablePk() {
        haptics.strong();
        pk.enableMode().then(() => this.load());
    },

    rename() {
        const that = this;
        haptics.tap();
        wx.showModal({
            title: '给自己起个名字',
            editable: true,
            placeholderText: '好友在 PK 榜上看到的名字',
            content: this.data.me.nick,
            success(res) {
                if (!res.confirm) {
                    return;
                }
                const name = String(res.content || '').trim();
                if (!name) {
                    return;
                }
                pk.setNick(name).then(function (profile) {
                    that.setData({ me: { nick: profile.nick, initial: initialOf(profile.nick) } });
                    return pk.createInvite();
                }).then(function (invite) {
                    that.setData({ inviteToken: invite.token });
                }).catch(function () {
                    wx.showToast({ title: '改名没成功', icon: 'none' });
                });
            },
        });
    },

    exitPk() {
        const that = this;
        haptics.tap();
        wx.showModal({
            title: '退出 PK',
            content: '好友关系与对端数据会被清除，你的记录不受影响。确定退出？',
            confirmText: '退出',
            success(res) {
                if (!res.confirm) {
                    return;
                }
                pk.disableMode().then(function () {
                    that.setData({
                        mode: false,
                        friends: [],
                        activeId: '',
                        rows: [],
                        summary: '',
                    });
                });
            },
        });
    },

    revokeActive() {
        const that = this;
        const friend = this.data.friends.filter(function (f) {
            return f.id === that.data.activeId;
        })[0];
        if (!friend) {
            return;
        }
        wx.showModal({
            title: '解除关系',
            content: '解除后你们将看不到彼此的排名，随时可以重新邀请。',
            confirmText: '解除',
            success(res) {
                if (!res.confirm) {
                    return;
                }
                pk.revoke(friend.id).then(function () {
                    that.load();
                });
            },
        });
    },

    onShareAppMessage() {
        haptics.tap();
        return {
            title: this.data.me.nick + ' 邀你比一比：谁拉得更顺',
            path: '/pages/pk/invite?t=' + this.data.inviteToken,
        };
    },
});
