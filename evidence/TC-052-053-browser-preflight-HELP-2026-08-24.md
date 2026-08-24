# TC-052 / TC-053 玩法说明入口 Chrome 自动化预检

状态：`AUTOMATED PREFLIGHT PASS / HUMAN ACCEPTANCE NOT RUN`。

本报告记录 AI 代理在真实 Chrome 中对页头右上角问号入口和玩家玩法说明页所做的补充预检。它不能替代 TC-052 真人键盘执行、TC-053 真人屏幕阅读器听读或规定签署。

## 1. 冻结对象

- 执行日期：2026-08-24（Asia/Dubai）
- 游戏 URL：`http://127.0.0.1:4173/`
- 说明 URL：`http://127.0.0.1:4173/help.html`
- 服务对象：最终 `dist/`
- manifest files：31
- `bundle_hash`：`42533e1ab7fa9d5f068f98dd0ccb8d28d5c5e2eb7ca9ef14300e3496ca298bb4`
- `evidence_hash`：`e5a9f94aa0b27db68c455ff4e52b198573619a9d158ddd2002b8084b0918ced7`
- `index.html`：2676 bytes，SHA-256 `d483e786a8b88497e086d6dd667892c6c2d0366d7bee516dd1ca65f2f737e6bc`
- `help.html`：5955 bytes，SHA-256 `9a33b11626320bef95726c7a20c7d610add5ae9d164f3b277aae06f1504201d6`
- `src/presentation/styles.css`：9346 bytes，SHA-256 `3e502c089299ffb9f7f0d5aa843fe9b4ffaec19c64cca3bb3ffe396910aa62fe`

## 2. 实现范围

- 游戏页头右上角新增圆形 `?` 链接，位于牧场状态区上方。
- 可访问名称为“打开玩法说明（新窗口）”，并提供“玩法说明”悬停标题。
- 入口在新标签页打开 `help.html`，避免打断当前游戏页面或丢失未提交表单内容。
- 说明页包含快速开始、工时与资源、页面功能、日期推进、键盘操作、存档与备份六章，并提供目录、跳到正文和“返回田园日志”链接。
- 说明页不加载游戏脚本，不读取或修改 LocalStorage 存档。
- 构建脚本强制检查说明入口目标存在，并把 `help.html` 收入正式 `dist/`。

## 3. 最终 Chrome 复验

1. 游戏页 DOM 快照中，`?` 暴露为名称完整的链接“打开玩法说明（新窗口）”，目标为 `./help.html`。
2. 实际截图确认问号位于页头最右上方，没有遮挡日期、资金、工时或专注状态。
3. 点击问号后保留原游戏标签页，并打开标题为“玩法说明 · 田园日志”的新标签页，最终 URL 为 `/help.html`。
4. 说明页 DOM 快照依次识别一级标题、六个目录链接、六章正文、数据表、键盘按键文本和返回入口。
5. `index.html`、`help.html` 与 `styles.css` 的 HTTP 返回字节 SHA-256 均与 manifest 一致。

## 4. 自动化与边界

- 入口专项静态回归：PASS；UI 静态测试 9/9。
- 完整 Node 自动化：115/115 PASS；fail/cancelled/skipped/todo 均为 0。
- 长跑、黄金回放、六策略和证据生成全部通过。
- TC-052 K-01—K-17 与 TC-053 A-01—A-17 仍为 `NOT RUN`，必须由真人按协议执行并签署。

