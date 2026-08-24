# QA RESULT — 导航稳定性修复冻结候选

## 1. 结论

**项目：**《田园日志》  
**内容版本：** `0.2.0`  
**复测日期：** 2026-08-24（Asia/Dubai）  
**AUTOMATION QA：PASS**  
**整体 RELEASE：HOLD**

“田区 ↔ 待办”切换时主导航随页面长短上下跳动的问题已修复。完整自动化链通过，Node 测试 113/113，无新增 S0、S1 或 S2。真人 TC-052、TC-053 与真实 20 人 TC-055 尚未执行或签署，因此整体发布继续保持 `HOLD`。

## 2. 变更范围

- `src/presentation/app.js`：菜单点击前判断导航是否已吸顶；仅在已吸顶时把新正文重新对齐到导航下方。
- `src/presentation/styles.css`：稳定纵向滚动条槽，并为短页面提供足够的最小正文高度。
- `tests/ui-static.test.mjs`：冻结上述交互与样式约束。
- 没有修改核心规则、内容、存档格式、命令 ID、状态枚举、LocalStorage 键或黄金回放。

## 3. 自动化结果

按 `npm run verify` 的同一六阶段顺序使用 Node 22 执行：

| 阶段 | 结果 |
|---|---|
| 内容校验 | PASS；19 作物、10 天气、5 动物、8 配方、8 建筑、8 居民、3 区域、183 事件 |
| 数值校验 | PASS |
| Node 自动化 | 113/113 PASS；fail/cancelled/skipped/todo 均为 0；105617.647542 ms |
| 长跑模拟 | PASS；天气 10,000 季、事件 10,000 日、100,000 样本与命令、1,000 次幂等检查，违规均为 0 |
| 六策略 | 6 类 × 3 种子 × 84 日；违规 0、`free_loop_detected=false`、`dominant_strategy=null` |
| 构建 | PASS；`dist/` 30 个文件 |
| 证据生成 | PASS；退出码 0 |

黄金 v2 的 7/21/84 日状态与日志哈希继续命中；历史 v1 未覆盖。策略活动仍覆盖五物种、200 批加工、6 次购畜、3 次畜棚完成、216 个订单周及 25/25 接受/交付。

## 4. 发布包与独立复算

- `bundle_hash`：`581ef0ace757d251f1555d3f12ce6882d2a0387c5c50a3245a6f39df1e026009`
- `evidence_hash`：`1e64875b9c3742b0923aa252e59fa59e95b797249b859f49c3d8f2ef031a26e5`
- manifest / 实际 `dist/`：30/30 路径、字节与 SHA-256 匹配。
- 独立规范 JSON 复算：`bundle_hash` 与 `evidence_hash` 均匹配。
- `release-manifest.json` SHA-256：`bea4b6fbd0560228d97ba9f4b5f21a9622647d7ccae43d4af25f90a4f5c8d497`
- `acceptance-summary.json` SHA-256：`ff9ca0eab657a5fd54e48bad5ba949f7a52a46696dcc51571c90205c785990c1`

关键发布文件：

- `index.html`：2449 bytes，`c3ba565868b8f68defab6cd4fe499cb68f80e3de0f75096f494a2b2cdb688ad5`
- `src/presentation/app.js`：53340 bytes，`14976327587c36addeefa00da7c260d26f34158f83003206ad3aff8543075cf2`
- `src/presentation/styles.css`：7500 bytes，`8e8ff3b07ff8485f6a538c64cdb6fc7309f42a669a91530c4f8495b64712f1de`

## 5. 浏览器复验与人工边界

新 Chrome 自动化预检在最终 `dist/` 上同时覆盖页头可见和导航已吸顶两种状态。“田区”“待办”的 `navTop`、`navLeft` 在各自状态内完全一致；已吸顶时正文顶边稳定在导航下方。该记录是自动化预检，不是 TC-052/053 真人结果。

旧 2026-08-20 QA、Design Review 与浏览器预检绑定旧哈希，已经失效并仅保留为历史。当前仍需：

1. 真人完成 TC-052 K-01—K-17 与规定签署。
2. 真人以协议支持的屏幕阅读器组合完成 TC-053 A-01—A-17 与规定签署。
3. 完成 TC-055 真实 20 人研究，复合成功至少 16/20，并取得 QA / Game Designer 双签。

**最终判定：AUTOMATION QA = PASS；OVERALL RELEASE = HOLD。**

