# QA RESULT — WP 操作费用提示冻结候选

## 1. 结论

**项目：**《田园日志》  
**内容版本：** `0.2.0`  
**复测日期：** 2026-08-24（Asia/Dubai）  
**AUTOMATION QA：PASS**  
**整体 RELEASE：HOLD**

所有可能消耗 WP 的玩家操作现在都在触发按钮内明显显示费用；固定、动态、条件免重复收费和当日共享费用均与实际规则一致。完整自动化链通过，Node 测试 114/114，无新增 S0、S1 或 S2。真人 TC-052、TC-053 与真实 20 人 TC-055 尚未执行或签署，因此整体发布继续保持 `HOLD`。

## 2. 变更范围

- `src/presentation/app.js`：以 15 类命令的显式白名单约束 WP 操作；统一生成按钮内费用标签；支持固定、表单动态、条件与共享费用；事件预览显示 WP / 专注变化。
- `src/presentation/styles.css`：费用标签使用边框、加粗与下划线形成明显视觉层级。
- `tests/ui-static.test.mjs`：冻结 15 类白名单、按钮内标签、动态输入同步、条件费用、事件变化和样式约束。
- 没有修改核心规则、内容、存档格式、命令 ID、状态枚举、LocalStorage 键或黄金回放。

## 3. 自动化结果

按 `npm run verify` 的同一六阶段顺序使用 Node 22 执行：

| 阶段 | 结果 |
|---|---|
| 内容校验 | PASS；19 作物、10 天气、5 动物、8 配方、8 建筑、8 居民、3 区域、183 事件 |
| 数值校验 | PASS |
| Node 自动化 | 114/114 PASS；fail/cancelled/skipped/todo 均为 0；103582.203833 ms |
| 长跑模拟 | PASS；天气 10,000 季、事件 10,000 日、100,000 样本与命令、1,000 次幂等检查，违规均为 0 |
| 六策略 | 6 类 × 3 种子 × 84 日；违规 0、`free_loop_detected=false`、`dominant_strategy=null` |
| 构建 | PASS；`dist/` 30 个文件 |
| 证据生成 | PASS；退出码 0 |

黄金 v2 的 7/21/84 日状态与日志哈希继续命中；历史 v1 未覆盖。策略活动仍覆盖五物种、200 批加工、6 次购畜、3 次畜棚完成、216 个订单周及 25/25 接受/交付。

## 4. 发布包与独立复算

- `bundle_hash`：`b60c2ce385643dc73ac9bc434491535da84f3ae4367d8de826a4cf7563b7e8e2`
- `evidence_hash`：`f813417e4dd612335b78c6b97d37dc1928ab4a83809145af58f6551d5756d048`
- manifest / 实际 `dist/`：30/30 路径、字节与 SHA-256 匹配。
- 独立规范 JSON 复算：`bundle_hash` 与 `evidence_hash` 均匹配。
- `release-manifest.json` SHA-256：`39ef2a777f038b633ef27d678271bf0d046e843ac1123b3b7ffcff9bd4a883f3`
- `acceptance-summary.json` SHA-256：`0623ca60b6bb34f8a89180a3fc4ad4a6333913274b66a8f2d6da91d5f23e2932`

关键发布文件：

- `index.html`：2449 bytes，`c3ba565868b8f68defab6cd4fe499cb68f80e3de0f75096f494a2b2cdb688ad5`
- `src/presentation/app.js`：58188 bytes，`3c1a417065a7b23eaccfb399e1d1cf577e9a02914fc996ca9dfc8fa13f363dec`
- `src/presentation/styles.css`：7747 bytes，`b0caee811d3a54cde5a7f20fdf29324ba86a3647a75ef84f3db0981183829c33`

## 5. 浏览器复验与人工边界

Chrome 在最终 `dist/` 上逐页扫描“今日、田区、动物、加工、小镇”的 WP 操作按钮，全部出现费用标签；自定义工作输入从 1/1 改为 3/2 时，可见文本和按钮无障碍名称均同步更新。HTTP 实际返回的脚本与样式哈希和 manifest 一致。该记录是自动化预检，不是 TC-052/053 真人结果。

当前仍需：

1. 真人完成 TC-052 K-01—K-17 与规定签署。
2. 真人以协议支持的屏幕阅读器组合完成 TC-053 A-01—A-17 与规定签署。
3. 完成 TC-055 真实 20 人研究，复合成功至少 16/20，并取得 QA / Game Designer 双签。

**最终判定：AUTOMATION QA = PASS；OVERALL RELEASE = HOLD。**

