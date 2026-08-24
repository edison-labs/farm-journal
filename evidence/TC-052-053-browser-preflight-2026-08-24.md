# TC-052 / TC-053 导航稳定性修复候选 Chrome 自动化预检

状态：`AUTOMATED PREFLIGHT PASS / HUMAN ACCEPTANCE NOT RUN`。

本报告记录 AI 代理在真实 Chrome 中对主导航跳动修复所做的补充预检。它只用于定位缺陷和降低真人验收风险，不能替代 TC-052 真人键盘执行、TC-053 真人屏幕阅读器听读或规定签署。

## 1. 冻结对象

- 执行日期：2026-08-24（Asia/Dubai）
- URL：`http://127.0.0.1:4173/`
- 服务对象：最终 `dist/`
- manifest format：`farm-journal-release-manifest-v1`
- manifest generated_at：`fixed-clock:2026-03-02T05:00:00.000Z`
- manifest files：30
- `bundle_hash`：`581ef0ace757d251f1555d3f12ce6882d2a0387c5c50a3245a6f39df1e026009`
- `evidence_hash`：`1e64875b9c3742b0923aa252e59fa59e95b797249b859f49c3d8f2ef031a26e5`
- `index.html`：2449 bytes，SHA-256 `c3ba565868b8f68defab6cd4fe499cb68f80e3de0f75096f494a2b2cdb688ad5`
- `src/presentation/app.js`：53340 bytes，SHA-256 `14976327587c36addeefa00da7c260d26f34158f83003206ad3aff8543075cf2`
- `src/presentation/styles.css`：7500 bytes，SHA-256 `8e8ff3b07ff8485f6a538c64cdb6fc7309f42a669a91530c4f8495b64712f1de`
- 协议版本：1.0；协议 SHA-256 `6cca25e0fac041a5944b058a116075e6a7f4a63428f77747d03bfa0ee0e87776`
- 检查视口：1496 × 793/794 CSS px；浏览器控制接口未暴露完整版本，因此不满足正式人工环境字段要求。

## 2. 缺陷与修复

用户报告在“田区”和“待办”之间切换时导航焦点位置跳动。旧构建实测：短“待办”页受最大滚动范围限制，`scrollY=9`、导航顶边约 `126.44px`；切到较长“田区”页后，切页函数把正文强制对齐到吸顶栏下方，`scrollY=190`、导航顶边变为 `0px`。反向切换时导航再次掉回页头下方。非覆盖式滚动条平台还可能因长短页滚动条出现/消失产生横向位移。

修复包含三项：

1. 菜单点击前记录导航是否已经吸顶；未吸顶时保持当前页面位置，避免从完整页头突然跳到吸顶状态。
2. 已吸顶时继续把新正文定位在吸顶栏下方，保留长页切换的可达性语义。
3. 为短页提供稳定的最小正文高度，并固定纵向滚动条槽，避免短页无法维持吸顶位置及横向居中位移。

`tests/ui-static.test.mjs` 增加对应结构回归；针对性测试 7/7 通过，完整 Node 自动化 113/113 通过。

## 3. 最终 Chrome 量化复验

全部观察均来自重新构建后的最终 `dist/`，且 HTTP 实际返回的 `app.js`、`styles.css` 字节数与 SHA-256 和 manifest 一致。

| 场景 | 页面 | scrollY | navTop | navLeft | mainTop | 结果 |
|---|---|---:|---:|---:|---:|---|
| 页头完整可见 | 田区 | 0 | 135.4375 | 158 | — | 稳定 |
| 页头完整可见 | 待办 | 0 | 135.4375 | 158 | — | 稳定 |
| 导航已吸顶 | 田区 | 190 | 0 | 158 | 74.8203125 | 稳定 |
| 导航已吸顶 | 待办 | 190 | 0 | 158 | 74.8203125 | 稳定 |

两种状态下“田区 ↔ 待办”切换均未发生导航纵向或横向位移；焦点仍进入 `#main-content`，已吸顶场景的新正文没有被导航遮挡。

## 4. 边界

- 结论仅为本轮真实 Chrome 自动化预检通过。
- TC-052 K-01—K-17 仍为 `NOT RUN`，须由真人全程键盘执行并签署。
- TC-053 A-01—A-17 仍为 `NOT RUN`，须由真人使用 Safari + VoiceOver 或 Windows Chrome/Firefox + NVDA 执行并签署。
- 2026-08-20 预检绑定旧 `bundle_hash`，只保留为历史缺陷记录，不适用于当前候选。

