# 拉了么 · 交接手册

> 这份文档是给**后续接手的 AI 或开发者**看的。
> 目标：读完这一份，不需要翻历史对话，就能安全地继续改这个项目。
>
> 最后更新：2026-11-17 · 对应版本 v1.14.0

---

## 一、项目速览

| 项 | 值 |
|---|---|
| 产品 | 「拉了么」——极度克制的肠道健康记录小程序 |
| 形态 | 微信原生小程序，**零第三方依赖**，数据 100% 存本机 |
| 代码位置 | `laleme-miniprogram/`（仓库根目录还有 Web 原型与图标生成脚本） |
| 当前版本 | **1.14.0**（庆祝传播 + 拉霸打磨） |
| 包体 | 上传约 340KB |
| AppID | `wxc8c0a431489d7ea7` |
| 仓库 | https://github.com/i-am-gee/laleme |
| 基础库 | ≥ 2.30.0 |

核心交互只有一件事：**点首页中央的大圆按钮，记一次**。所有设计决策都围绕"降低记录成本"。

---

## 二、开发环境与常用命令

项目在微信开发者工具里开发，命令行工具是 `wechatide`。下文 `$P` 指 `laleme-miniprogram` 的绝对路径。

```bash
# 编译并打开某个页面
wechatide -c ide simulator_open_page --project $P --page pages/index/index

# 截图（返回一个 /var/... 的临时路径，需要自己 cp 出来）
wechatide -c ide simulator_screenshot --project $P

# 看运行时错误（返回空字符串 = 干净）
wechatide -c ide get_simulator_console --project $P --command "grep -iE 'error|warn|fail'"

# 上传体验版（同版本号会覆盖）
wechatide -c ide upload --project $P --upload-version 1.7.9 --desc "说明"

# 推真机预览
wechatide -c ide auto_preview --project $P
```

### 三种必用的验证手法

**1. 截图 + 放大看细节**
全屏截图只能看大局，细节要用 PIL 裁切放大再判断：

```bash
python3 -c "
from PIL import Image
im = Image.open('/tmp/shot.jpg'); w,h = im.size
im.crop((0, 745, w, 850)).resize((int(w*1.8), int(105*1.8)), Image.LANCZOS).save('/tmp/zoom.jpg')
"
```

**2. 临时改状态看极端形态**
已解锁态、空状态这类不好触发的界面，在页面 `onLoad` 里临时写 storage：

```js
onLoad(options) {
    wx.setStorageSync('laleme_share_badge', 1);   // 临时：模拟已解锁
    wx.setStorageSync('laleme_share_count', 3);
    this.setData({ navTop: getNavTop() });
}
```

**截完必须删掉这几行，并再编译一次把 storage 清空**，否则模拟器里会一直停在测试状态。

**3. 像素级核对**
判断"有没有露色""是否真的居中"时，直接扫像素比肉眼可靠：

```bash
python3 -c "
from PIL import Image
im = Image.open('/tmp/shot.jpg').convert('RGB'); px = im.load()
print([ (x,y) for y in range(700,850) for x in range(200,260) if px[x,y][0] > 200 and px[x,y][1] < 120 ])
"
```

---

## 三、代码地图

```
laleme-miniprogram/
├── app.wxss                 设计系统：全部 CSS 变量在这里，改颜色/字号/间距只改这一处
├── app.js                   隐私授权应答（onNeedPrivacyAuthorization）
├── app.json                 9 个页面 + custom tabBar + __usePrivacyCheck__
├── pages/
│   ├── index/               首页：Large Title / 大圆按钮 / 统计卡 / 六行日历 / 分享入口 / 庆祝动画
│   ├── history/             历史：按天分组、左滑改删、逐条飞入、日历锚定
│   ├── stats/               **段位页**：段位卡 → 好友 PK → 周/月指标、分布图、成就墙
│   ├── me/                  我的：数据概览、入口聚合、致谢与开源地址
│   ├── data/                备份恢复：导出/复制/导入（含确认）/清空
│   ├── record/              记录页薄壳，复用 record-form 组件
│   ├── pk/                  **好友 PK**：pk 主页面（三态）+ invite 授权落地页
│   └── privacy/             隐私指引全文
├── components/
│   ├── record-form/         记录表单：首页抽屉与编辑页共用，计时器与时长拉霸在这里
│   ├── roll-number/         拉霸滚动数字（逐位竖排）
│   ├── challenge-btn/       分享入口：首页与统计页共用，见下方「分享状态机」
│   └── timer-bar/           计时浮条：任意 Tab 页贴在 tabBar 上方，点击回首页继续记录
├── custom-tab-bar/          自定义底部导航（原生 tabBar 加不了震动反馈）
├── assets/                  tabbar(4×2) / badges(4×2) / actions(5) / bristol(7 形状 + 3 感受)
└── utils/
    ├── constants.js         布里斯托 7 型、徽章定义、月历口径、分享文案、隐私文本
    ├── record-store.js      存储层：list/create/update/remove，统一返回 {data, error}
    ├── share.js             分享信息 + 5:4 海报绘制 + **分享计数/称号/金色开关**
    ├── timer.js             **全局计时**：以开始时间戳为准，跨页面/切后台都不中断
    ├── rank.js              **段位制度**：连续天数 × 质量门槛晋级，断签退级
    ├── csv.js               CSV 导出解析（含末尾 # 附属状态行）
    ├── pk/                  **好友 PK 数据层**，见下方「PK 模块」
    │   ├── api.js           门面：周期口径 + 适配器切换（setAdapter）
    │   ├── local-api.js     本地实现：无服务端时的适配器，契约与云端一致
    │   └── score.js         评分：时长倒 U 曲线 + 布里斯托质量分
    ├── nav.js               Large Title 顶部安全距离
    └── haptics.js           震动三档：light / tap / strong
```

仓库根目录另有：`gen-*-icons.py`（PIL 图标生成脚本）、`拉了么/`（Web 原型）、`拉了么-产品设计文档.md`。

---

## 四、数据层

全部数据在 `wx.storage`，没有服务端、没有账号。

| Key | 内容 | 维护方 |
|---|---|---|
| `laleme_records` | 打卡记录数组 | `record-store.js` |
| `laleme_share_count` | 已拉起分享次数 | `share.js` |
| `laleme_share_badge` | 是否已解锁「黄金大屎官」（=1） | `share.js` |
| `laleme_gold_off` | 用户是否主动切回普通外观（=1） | `share.js` |
| `laleme_privacy_agreed` | 隐私授权已同意 | `app.js` |
| `laleme_privacy_pending` | 待处理的隐私请求 | `app.js` |
| `laleme_celebrate_flag` | 打卡后待播放的庆祝（时间戳） | `record-form` 写入、首页消费 |
| `laleme_badge_flag` | 称号达成后待播放的庆祝（时间戳） | `share.js` 写入、首页消费 |
| `laleme_thanks_flag` | 分享后待播放的致谢（时间戳） | `share.js` 写入、首页消费 |
| `laleme_timer_start` | 计时开始时间戳（有值即在计时） | `timer.js` 维护 |
| `laleme_draft` | 未保存的草稿：性状/感受/手填时长，24 小时过期 | `record-form` 读写 |
| `laleme_pk_profile` | PK 身份：随机 id + 可改昵称 | `pk/local-api.js` |
| `laleme_pk_mode` | 是否开启 PK（=1）。未开启时不产生任何 PK 数据 | 同上 |
| `laleme_pk_friends` | 已授权好友：id / nick / since | 同上 |
| `laleme_pk_peer_stats` | 对端周期统计快照（按 peerId + 周期 stamp） | 同上 |
| `laleme_pk_my_stats` | 本机周期统计的「上报」留痕 | 同上 |
| `laleme_rank` | 段位状态：level / peak / 断签基准 / 掉级提示 | `rank.js` |

**记录字段**：`id` / `timestamp`(ms) / `durationMin`(1–720) / `bristol`(1–7，可空) / `mood`(`good|normal|hard`，可空) / `color`(`brown|dark|tan|green|black|red`，可空)

**记录形态**：形状（布里斯托 1–7，可空）+ 颜色（6 档，可空）+ 感受（通畅/一般/费劲，可空）。
颜色只做记录与展示，不参与 PK 评分；发黑/带红只给一句就医提示，不做诊断。

**分享状态机**：

```
count 0..2  →  badge=0, gold=0  →  普通棕色按钮 + 「已转发 N 次 · 还差 M 次解锁黄金大屎官」
count >= 3  →  badge=1, gold=1  →  金色按钮 + 日历便便镀金 + 「已解锁『黄金大屎官』，让更多人闪闪发光」
             →  点底部那行字切 gold=0（纯展示开关，不影响 badge）
```

备份导出时，分享状态以 `# 分享次数,N` / `# 大屎官,1` 两行附在 CSV 末尾；导入按合并语义取较大值，不会降级。

**PK 模块（v1.9.0 新增）**

```
pages/pk/*  ──►  utils/pk/api.js  ──►  local-api.js    （现在）
                                   └─►  remote-api.js   （接云开发后）
```

- 页面只 require `api.js`，**永远不知道背后是本地还是云端**。换实现只有一行：
  `require('./utils/pk/api.js').setAdapter(require('./utils/pk/remote-api.js'))`
- 当前只有本地实现，且**没有跨设备能力**：邀请 token 只带邀请人的 id 与昵称，
  对端统计一律返回 null，页面显示「等待对方同步数据」。
  **不要为了演示在客户端伪造好友数据**——那会让「授权后才互见」这件事失去意义。
- 三个维度各自判定：次数比大；平均时长比谁更接近 5.5 分钟；质量分比高。
  时长故意做成倒 U（`D(t) = 100 · exp(−(ln(t/5.5))²/2)`），因为久蹲不是优点，
  线性「越久越高」会直接制造刷分行为。
- 授权：一次性 token（48 小时有效），双向只存一条关系；任一方可解除，退出 PK 会清掉关系与对端快照。
- 服务端上线后要改的只有三处：local-api 换 remote-api、评分公式复制进云函数作唯一权威、
  `records` 增加 `clientId` 幂等键与 `source` 字段（手动补录不入榜）。

---

**段位制度（v1.11.0 新增，v1.12.0 简化为纯天数）**

```
青铜 3 天 · 白银 7 天 · 黄金 10 天 · 铂金 14 天 · 钻石 21 天 · 星耀 30 天 · 王者 60 天
```

- **只看连续天数**，不看性状、不看质量（v1.12.0 起）。要调档只改 `rank.js` 的 `TIERS` 一处。
- **只升不降**：唯一会掉级的原因是断签。
- **记录被删会重算段位**：storage 里存了上次结算的记录条数 `count`，条数变少即认为删过记录，
  段位按当前连续天数重算（`peak` 一起回落，不弹掉级横幅）。正在受断签惩罚的用户跳过这条，
  否则会把他们惩罚后的等级再压一次。**没有这条会出现「删了历史、重新连 7 天却不晋级」**——
  旧段位虚高，`earned` 永远追不上，动画也就永远不触发。
- **断签退级**：断签首日掉 1 级，此后每再断 3 天多掉 1 级（`DECAY_EVERY`），最多退到未定级。
  基数是「断签开始那一刻的等级」，因此同一天反复进小程序不会重复扣；重新记录即止跌。
- **每档一枚便便图标**：`assets/rank/{none,bronze,silver,gold,platinum,diamond,star,king}.png`，
  由根目录 `gen-rank-icons.py` 生成（渐变体块 + 奶白描边 + 逐档加装饰）。
  首页「记一次」按钮直接用它（`rankIcon`），段位卡的解锁刻度也用同一套。
- **解锁刻度**：段位页进度条下方一行 7 个图标，按连续天数点亮；未解锁 `opacity: 0.32`，当前档 `scale(1.16)`。
- **晋级庆祝**：`rank.sync()` 把「待播晋级」写进 storage（`pendingUp`），首页用 `rank.takePendingUp()` 取走再播。
  **取到空值时不要覆盖页面里待播的那条**：同一屏可能连跑两次 `refresh`，后一次的空值会把动画冲掉。
  两个页面都会结算段位，动画必须走存储传递，否则统计页先结算就把这次晋级吞掉了。
  v1.12.0 起晋级庆祝**常驻不自动退场**（`playCelebrate` 第 5 个参数 `{persistent:true}`），
  底部是带扫光与呼吸动画的金色「邀请好友挑战」（含分享图标），**只能点右上角 × 关闭**，
  空白处不响应（`onCelebrateMaskTap` 在 `celebrateActions` 为真时直接返回）；
  彩带与烟花在 `.celebrate-mask.hold` 下无限循环。
  分享走 `open-type="share"`，`_shareRank` 让 `onShareAppMessage` / `onShareTimeline` 换成晋级战报。
- **重回也要有动画**：掉级后连续天数重新爬到 `peak` 时，标题改「重回 X」，副文案「断过一段，还是爬回来了」，同时收起掉级横幅。
- **掉级提示**：首页顶部横幅，出现 8 秒自动收走，点 ✕ 则 3 天内不再提。首页纵向很紧，**不要**把它做成常驻行。
- **口径修正**：聊天原型里「连续 5 天正常 = 黄金」比「连续 7 天 = 白银」天数短，照抄会出现
  「连到第 6 天反而掉段」。这里把黄金提到 10 天，让天数严格单调。
- **清空数据**会连段位一起清（`data.js` 里调 `rank.clear()`），否则会留下幽灵称号。
- **底部 tab 顺序是：首页 → 段位 → 历史 → 我的**（段位紧跟首页，它是主线的延伸；路由仍是 `pages/stats/stats`）。
  图标 `assets/tabbar/rank*.png`（奖牌）由 `gen-tabbar-icons.py` 的 `draw_rank` 生成。
  改顺序要同时动三处：`app.json` 的 tabBar.list、`custom-tab-bar/index.js` 的 LIST、各页 `syncTabBar(page, N)` 的下标。
## 五、设计系统速查

所有取值在 `app.wxss` 顶部，**页面里不要写死颜色和字号**。

| 维度 | 规则 |
|---|---|
| 换算 | 苹果 1pt = 2rpx |
| 字号 | 68 / 56 / 44 / 40 / 34 / 32 / 30 / 26 / 24 / 22rpx（`--t-*`） |
| 色彩 | 只用语义令牌：`--bg` `--bg-card` `--fill-1/2/3` `--label/2/3/4` `--sep` `--tint` |
| 主色 | `--tint: #8b5e3c`（品牌棕），金色系 `#b8893c → #e9cb80` |
| 间距 | `--sp-1..6` = 8 / 16 / 24 / 32 / 48 / 64rpx |
| 圆角 | `--r-sm` 16 / `--r-md` 24 / `--r-lg` 32 / `--r-full` 999rpx |
| 大按钮 | 高 96–100rpx + `--r-full` 胶囊 |
| 动效 | `--ease-sheet` 进入、`--ease-spring` 按压；不做常驻装饰动画 |
| 数字 | 一律 `font-variant-numeric: tabular-nums` |

**模块间距**：卡片之间 `--sp-3`，卡片内元素之间 `--sp-2`。四个 Tab 页保持一致，不要一处 12rpx 一处 24rpx。

---

## 六、改动前必读

1. **首页纵向预算已经到顶。** 从标题到分享入口，正好占满一屏。任何"再加一个元素"都会挤掉别的东西——要么换成不占高度的表达（文字/内联），要么先想清楚从哪儿减。前几轮为了塞进新需求，大圆按钮从 300rpx 一路缩到 236rpx。
2. **改页面 WXML 前先列出这个页面的所有浮层。** 曾经重写首页时把「记录抽屉 / 庆祝动画 / 隐私弹窗 / 分享 canvas」整块漏掉，功能静默损坏了好几轮没人发现。
3. **新组件加专属前缀。** 同一页的 WXSS 里类名会互相覆盖。踩过：分享按钮的文字用了 `.challenge-text`，被同页「好友挑战横幅」的 `color` + `flex:1` 覆盖，表现为文字发灰、图标被挤到最左。
4. **组件样式默认隔离**，但组件里用到的 CSS 变量要在组件根节点兜底一份，否则拿不到 `app.wxss` 的令牌。
5. **动效优先用 `backwards` 而不是 `both`** 作为 fill-mode。`both` 会让元素动画结束后长期持有 `transform`，形成合成层，圆角边缘可能露出下面 1px 的颜色。
6. **不要引入第三方依赖。** 这是产品的卖点之一，也是包体小的原因。

---

## 七、踩坑清单

| 现象 | 根因 | 解法 |
|---|---|---|
| 文字/图标颜色怎么调都不生效 | 类名与本页其他块重名，后写的覆盖了 | 加前缀，或直接改类名 |
| 新加的字段存进去读出来就没了 | `readRecords` 用固定形状做投影，没列出的字段会被静默丢弃 | 加字段要**同时改三处**：`toRow` 白名单、`create/update` 落库、`readRecords` 投影 |
| `<text>` 上设 `display:flex` 不居中 | 小程序 text 组件不完全支持 flex | 改用 `<view>`，或 `text-align` + `line-height` |
| CSS `filter` 没反应 | 作用对象是行内元素 | 加 `display: block / inline-block` |
| 遮罩不铺满全屏 | `inset: 0` 在部分基础库不生效 | 写死 `top/right/bottom/left: 0` |
| 庆祝遮罩盖不住底部导航 | custom tabBar 是框架独立节点 | `this.getTabBar().setData({ dim: true })` 让它自己压暗 |
| 按钮宽度改不动 | 微信 button 默认宽 184px | `width: 100% !important` |
| button 内部 flex 布局错乱 | button 默认样式干扰 | 里面再包一层 `<view>` 承载 flex |
| `showModal` 的 content 换行变空格 | content 不吃 `\n` | 用分号/句号串成一句话 |
| 组件读到的进度比实际旧 | 组件 `attached` 早于页面 `onShow` | 页面 `onShow` 里主动调 `selectComponent('#id').sync()` |
| 改完 wxml/wxss 截图没变化 | 编译器没热更新 | 先打开别的页面再回来，或 `simulator_reload` |
| 日历数字与便便不在一条中线 | 数字用了 `<text>`，`width` 生效但 `justify-content` 不生效 | 改 `<view>` |
| emoji 染色把圆底也染了 | `filter` 作用于整个元素 | 把 emoji 单独包一层 `<text>`，滤镜只打这层 |
| 断签后段位永远停在同一级 | 把「断签首日」缓存进 storage，之后都按第一次的天数算 | 断签首日**每次**由「最后一次记录」推导，只缓存「断签开始时的等级」 |
| 删了记录但段位不降 / 之后怎么连都不晋级 | 段位只在 sync 时按「升级」处理，删除不会触发降级，level 虚高 | `count` 变小即按天数重算，见「段位制度」 |
| 布尔字段存进去读出来变 false | `readState` 用 `=== 1` 判断，代码里写的却是 `true` | 写入统一用 1/0；读的时候两种都接受 |
| 庆祝层的 × 撞上微信胶囊或状态栏 | 右上角是微信胶囊，`env(safe-area-inset-top)` 在无刘海机型上为 0 | 用固定值 `top: 178rpx`，落在胶囊下方 |
| 历史侧滑图标显脏 | 铅笔/垃圾桶用实心多边形拼，边缘毛糙 | `gen-action-icons.py` 改成圆头描边（stroke + 两端补圆） |
| page-container 里 position:fixed 不生效 | page-container 用 transform 做进出场，fixed 被降级成相对容器 | 浮层挂在表单根节点上用 absolute，或提到页面层 |
| picker-view 永远停在第一项 | `value` 传的是数字，组件要的是数组 | 传 `[index]` |
| 表情图标怎么放大都显小 | 素材本身只占画布的 56%（54/96），放大的是空白 | 重绘让内容占 90/96（`gen-bristol-icons.py` 的 `face()`） |
| 掉级在一天内被反复扣 | 每次 sync 都从当前 level 往下减 | 退级基数用 `levelAtBreak`，并用「本次结算是否真的变化」决定写盘 |

**工具链坑**（只影响开发过程）：本机 bash 里 `grep` 会静默返回空，查内容用 Grep 工具或 `node -e`；python heredoc 改文件会误报 MISS（实际已写成功），改完必须 Read 复核；批量改样式用 `node -e` + `fs.writeFileSync` 更稳。

---

## 八、发布流程

```bash
# 1. 改完先做全量校验
cd laleme-miniprogram
for f in $(find . -name "*.js"); do node --check "$f"; done
for f in $(find . -name "*.json"); do python3 -c "import json;json.load(open('$f'))"; done
# WXSS 校验括号是否配平

# 2. 遍历所有页面确认 console 干净（打开每个页面再查）
# 3. 更新版本号：pages/me/me.wxml 的文案 + README 徽章
# 4. 上传
wechatide -c ide upload --project $P --upload-version x.y.z --desc "..."
# 5. 推真机
wechatide -c ide auto_preview --project $P
# 6. 提交 git
```

**正式发布只能在 [mp.weixin.qq.com](https://mp.weixin.qq.com) 后台操作**：管理 → 版本管理 → 开发版本 → 提交审核 → 审核通过后点发布。命令行工具没有提审能力。

注意事项：类目建议选「工具」而非「医疗」（后者可能要资质）；2023 年 9 月后新小程序需先完成备案才能发布。

---

## 九、当前状态与待办

**已完成**：记录/计时、布里斯托分类、六行日历（可切月、点天跳历史）、连续打卡与 4 枚徽章、庆祝动画、5:4 分享海报、分享三次解锁「黄金大屎官」（含金色身份手动切换、日历同步镀金）、CSV 备份恢复（含分享状态、导入前确认差异）、清空全部数据、隐私授权、iOS 设计语言、图形化记录与统计、好友 PK（本地适配器）、段位制度。

**待办**：

- [ ] 后台提审 1.12.0（1.10.0 体验版已上传）
- [ ] `assets/actions/share.png` 已无人引用，可清理（省几 KB）
- [ ] 首页纵向已满，若要继续加功能，建议先做一次信息架构减法

**已知取舍**：

- 「最近一次」从日历卡脚注挪到了页面末尾，为分享入口腾出首屏空间
- 分享次数按「拉起」计数，微信不回调发送结果，这是平台限制
- 段位只按「连续天数 + 质量」判定，不看总记录量：这是产品调性（不制造焦虑）的取舍，不是遗漏
- 掉级横幅会临时占用首页第一屏空间，所以做成 8 秒自动收走

---

## 十、版本历史

| 版本 | 关键变化 |
|---|---|
| 1.14.0 | 晋级庆祝加金色扫光按钮与分享图标、右上角 × 关闭（避开微信胶囊）；时长拉霸上限收到 60 分钟、首项改「计时中」、滚动静默震动、底部加一句关心话术、选中行加高亮带与上下淡出；历史侧滑的编辑/删除换成新绘制的线性图标并配文字；「转发给你在乎的人」改为「分享给你在乎的人」 |
| 1.13.0 | 底部 tab 改为「首页 · 段位 · 历史 · 我的」；记录浮层的时长改成拉霸选择（0 位是「取计时时长」，默认停在 5 分钟，不碰它仍按计时走） |
| 1.12.0 | 段位只按连续天数（去掉质量维度）；八枚材质递进的段位便便图标，首页主按钮与段位刻度共用；晋级庆祝改为常驻并加「确认 / 邀请好友挑战」，分享内容换成晋级战报；底部「统计」改「段位」（奖牌图标），段位卡与 PK 入口前置；删除「每天几次」模块；记录浮层形状图标 64→108rpx、4 型「理想」前置；删记录后段位按天数重算（修「重新晋级无动画」）；金色角标改奶白环 + 白字；感受模块与颜色模块统一盒子，表情图标重绘为占满画布；晋级庆祝只留「邀请好友挑战」，点空白关闭 |
| 1.11.0 | 段位制度：6+1 档（青铜→王者），连续天数 + 正常日占比双门槛，断签按天数退级；首页统计栏第一格显示段位、掉级横幅、晋级/重回庆祝；统计页段位卡含进度条 + 按天数点亮的七阶刻度 |
| 1.10.0 | 记录浮层改成图形化：7 型形状图标 + 6 档颜色 + 3 种感受表情；统计页新增「每天几次」，一天一行、每次用形状图标 + 颜色条表示；PK 页新增排名榜 |
| 1.9.0 | 新增好友 PK：三维对比（次数/平均时长/质量分）、邀请授权落地页、退出与解除关系；服务端未接入，走 local-api 适配器 |
| 1.8.6 | 金色模式下日历里「同日多次」的角标也镀金（金底深字 + 奶白描边），不再留棕色 |
| 1.8.5 | 修「沿用上次选择」一直取到最旧一条（readRecords 是倒序，应取 list[0]）；草稿不再存时长；按钮文案「轻触结束」改「计时中」 |
| 1.8.4 | 计时中按按钮只拉起浮层，表继续走、按钮保持计时态，直到点「完成记录」才停表复位 |
| 1.8.3 | 浮层草稿持久化（关掉、换页再回来选择还在）；结束计时后时长输入框留空、用计时结果落库；修掉 onLoad 里残留的一行 setStorageSync 导致每次进首页都播致谢 |
| 1.8.2 | 计时结束改为拉起浮层补录性状（openFinish）；新建记录时长默认留空，不再预填上次 |
| 1.8.1 | ~~抽屉式计时卡、欢迎页~~ 已回滚 |
| 1.8.0 | 计时全局化：关掉抽屉也继续走，首页按钮显示时间、再按结束；其余 Tab 页有计时浮条可跳回；超过 1 小时自动收尾。致谢动画改为无卡片的暗底大图，与打卡庆祝同构。打开抽屉默认沿用上次的性状与感受 |
| 1.7.11 | 致谢动画加金色系彩带与烟花环，时长 3.2s；卡片加金色描边、标题转金 |
| 1.7.10 | 分享后加轻量致谢动画（金色便便 + 感谢语，2.4 秒自动退场）；称号庆祝优先，不与致谢叠加 |
| 1.7.9 | 首页间距统一到令牌；解锁文案「让更多人闪闪发光」+ 身份可切换；导入前先比对再确认 |
| 1.7.8 | 进度文案点出「黄金大屎官」；解锁后日历便便同步镀金 |
| 1.7.7 | 分享区回到统一胶囊，进度改用文字 |
| 1.7.6 | 分享区三图标方案；话术从「比拼」转「关心」 |
| 1.7.5 | 组件化分享入口；备份含称号；清空一并清除 |
| 1.7.4 | 挑战按钮抽成组件，首页与统计共用 |
| 1.7.3 | 分享三次解锁「大屎官」；我的页致谢与开源地址 |
| 1.7.2 | 挑战入口移到日历下方；tabBar 放大；历史逐条飞入 |
| 1.7.1 | 修复记录抽屉；日历固定六行 |
| 1.7.0 | 拉霸数字动画；首屏挑战入口 |
| 1.6 | 全站改造为 iOS / Apple Design Language |

---

## 十一、给下一个 AI 的三句话

1. **先读 `app.wxss` 的变量表**，再动手改样式——这个项目的视觉一致性靠令牌维持，硬编码一个色值就会破坏它。
2. **改首页前先数一遍高度**，那是全项目最紧的一屏。
3. **每次改完都截图看**，不要相信"逻辑上应该没问题"——前面十来轮需求里，绝大多数问题都是靠截图发现的。
