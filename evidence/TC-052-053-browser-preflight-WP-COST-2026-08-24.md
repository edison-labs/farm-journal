# TC-052 / TC-053 WP 操作费用提示 Chrome 自动化预检

状态：`AUTOMATED PREFLIGHT PASS / HUMAN ACCEPTANCE NOT RUN`。

本报告记录 AI 代理在真实 Chrome 中对“需要消耗 WP 的操作必须明显提示费用”的补充预检。它用于降低真人验收风险，不能替代 TC-052 真人键盘执行、TC-053 真人屏幕阅读器听读或规定签署。

## 1. 冻结对象

- 执行日期：2026-08-24（Asia/Dubai）
- URL：`http://127.0.0.1:4173/`
- 服务对象：最终 `dist/`
- manifest format：`farm-journal-release-manifest-v1`
- manifest generated_at：`fixed-clock:2026-03-02T05:00:00.000Z`
- manifest files：30
- `bundle_hash`：`b60c2ce385643dc73ac9bc434491535da84f3ae4367d8de826a4cf7563b7e8e2`
- `evidence_hash`：`f813417e4dd612335b78c6b97d37dc1928ab4a83809145af58f6551d5756d048`
- `index.html`：2449 bytes，SHA-256 `c3ba565868b8f68defab6cd4fe499cb68f80e3de0f75096f494a2b2cdb688ad5`
- `src/presentation/app.js`：58188 bytes，SHA-256 `3c1a417065a7b23eaccfb399e1d1cf577e9a02914fc996ca9dfc8fa13f363dec`
- `src/presentation/styles.css`：7747 bytes，SHA-256 `b0caee811d3a54cde5a7f20fdf29324ba86a3647a75ef84f3db0981183829c33`
- 协议版本：1.0；TC-052 / 053 协议 SHA-256 `6cca25e0fac041a5944b058a116075e6a7f4a63428f77747d03bfa0ee0e87776`

## 2. 变更与覆盖面

15 类可能消耗 WP 的玩家命令统一由显式白名单覆盖：

`crop.plant`、`crop.harvest`、`crop.irrigate`、`crop.irrigate_batch`、`crop.weed`、`crop.fertilize`、`housing.clean`、`housing.graze`、`animal.interact`、`animal.treat`、`processing.queue`、`building.invest`、`exploration.run`、`resident.talk`、`work.assign`。

费用提示位于触发操作的按钮内部，使用带边框、加粗、下划线的小标签显示，因此视觉上与普通说明区分；标签同时进入按钮的无障碍名称。固定费用、表单动态费用、当日共享费用和不再重复收费四种语义均按真实规则展示：

- 固定费用示例：收获 `消耗 1 WP`；探索 `消耗 2 WP / 1 专注`。
- 动态费用示例：自定义工作和工程投入随 WP / 专注输入即时更新。
- 当日共享费用示例：加工当天首批显示 `消耗 1 WP / 1 专注`，后续批次明确提示不再额外消耗。
- 条件费用示例：已经安排的灌溉、清洁、放牧或恢复中的治疗明确提示不再额外消耗。
- 事件选择预览同步显示实际 WP / 专注变化，确认按钮内显示对应费用。

静态回归会从实现源码提取 WP 命令白名单，并与上述 15 类精确集合比较，防止新增、遗漏或误标。

## 3. 最终 Chrome 复验

全部观察来自重新构建后的最终 `dist/`。HTTP 实际返回的 `app.js`、`styles.css` SHA-256 与 manifest 完全一致。

| 页面 | Chrome 观察到的费用提示 |
|---|---|
| 今日 | 添加工作：`消耗 1 WP / 1 专注` |
| 田区 | 批量 / 条件灌溉、除草、施肥、收获：各 `消耗 1 WP` |
| 动物 | 深度互动：`消耗 1 WP / 1 专注`；清洁、放牧：各 `消耗 1 WP` |
| 加工 | 8 个配方的安排批次按钮：各显示首批 `消耗 1 WP / 1 专注` |
| 小镇 | 8 位居民交谈：`消耗 1 WP / 1 专注`；3 个区域探索：`消耗 2 WP / 1 专注` |

动态输入复验：把自定义工作由 WP=1、专注=1 改为 WP=3、专注=2 后，按钮可见文本即时变为 `添加工作 消耗 3 WP / 2 专注`，Chrome DOM 快照中的按钮无障碍名称也同步为 `添加工作 消耗 3 WP / 2 专注`。复验没有提交或保存该表单。

## 4. 自动化与边界

- WP 专项静态回归：PASS；UI 静态测试 8/8。
- 完整 Node 自动化：114/114 PASS；fail/cancelled/skipped/todo 均为 0。
- 长跑、黄金回放、六策略和证据生成全部通过。
- TC-052 K-01—K-17 仍为 `NOT RUN`，须由真人全程键盘执行并签署。
- TC-053 A-01—A-17 仍为 `NOT RUN`，须由真人使用协议支持的屏幕阅读器组合执行并签署。

