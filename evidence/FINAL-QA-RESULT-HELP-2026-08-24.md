# QA RESULT — 玩法说明入口冻结候选

## 1. 结论

**项目：**《田园日志》  
**内容版本：** `0.2.0`  
**复测日期：** 2026-08-24（Asia/Dubai）  
**AUTOMATION QA：PASS**  
**整体 RELEASE：HOLD**

页头右上角已新增问号入口，并在新标签页打开正式构建内的玩家《玩法说明》。完整自动化链通过，Node 测试 115/115，无新增 S0、S1 或 S2。真人 TC-052、TC-053 与真实 20 人 TC-055 尚未执行或签署，因此整体发布继续保持 `HOLD`。

## 2. 变更范围

- `index.html`：在牧场状态区上方增加 `?` 入口，提供完整可访问名称、新窗口说明和安全的外链关系。
- `help.html`：新增不含脚本的玩家指南，覆盖快速开始、资源、十个页面、日期推进、键盘和备份。
- `src/presentation/styles.css`：新增圆形问号、清晰焦点轮廓、说明页版式与窄屏适配。
- `scripts/build.mjs`：把说明页纳入 `dist/`，并在构建时验证入口目标存在。
- `tests/ui-static.test.mjs`：冻结入口结构、可访问名称、样式、内容章节和构建收录。
- 核心规则、内容、存档格式、命令 ID、状态枚举、LocalStorage 键和黄金回放未修改。

## 3. 自动化结果

| 阶段 | 结果 |
|---|---|
| 内容校验 | PASS；19 作物、10 天气、5 动物、8 配方、8 建筑、8 居民、3 区域、183 事件 |
| 数值校验 | PASS |
| Node 自动化 | 115/115 PASS；fail/cancelled/skipped/todo 均为 0；85639.435042 ms |
| 长跑模拟 | PASS；天气 10,000 季、事件 10,000 日、100,000 样本与命令、1,000 次幂等检查，违规均为 0 |
| 六策略 | 6 类 × 3 种子 × 84 日；违规 0、`free_loop_detected=false`、`dominant_strategy=null` |
| 构建 | PASS；`dist/` 31 个文件 |
| 证据生成 | PASS；退出码 0 |

黄金 v2 的 7/21/84 日状态与日志哈希继续命中；历史 v1 未覆盖。策略活动仍覆盖五物种、200 批加工、6 次购畜、3 次畜棚完成、216 个订单周及 25/25 接受/交付。

## 4. 发布包与独立复算

- `bundle_hash`：`42533e1ab7fa9d5f068f98dd0ccb8d28d5c5e2eb7ca9ef14300e3496ca298bb4`
- `evidence_hash`：`e5a9f94aa0b27db68c455ff4e52b198573619a9d158ddd2002b8084b0918ced7`
- manifest / 实际 `dist/`：31/31 路径、字节与 SHA-256 匹配。
- 独立规范 JSON 复算：`bundle_hash` 与 `evidence_hash` 均匹配。
- `release-manifest.json` SHA-256：`6c76a8d7e1021f6dce5137234439a828966dd86b04203aaf240bb7f058350bbe`
- `acceptance-summary.json` SHA-256：`7871ee84e1a98f743d6c8ea453c0de96bf2ffe781fb29f56c48f73e25bf7a347`

关键发布文件：

- `index.html`：2676 bytes，`d483e786a8b88497e086d6dd667892c6c2d0366d7bee516dd1ca65f2f737e6bc`
- `help.html`：5955 bytes，`9a33b11626320bef95726c7a20c7d610add5ae9d164f3b277aae06f1504201d6`
- `src/presentation/styles.css`：9346 bytes，`3e502c089299ffb9f7f0d5aa843fe9b4ffaec19c64cca3bb3ffe396910aa62fe`

## 5. 浏览器复验与人工边界

Chrome 在最终 `dist/` 上确认问号实际位于页头最右上方，入口可被识别为“打开玩法说明（新窗口）”；点击后原游戏页保留，并打开标题和内容完整的 `help.html`。说明页具有一级标题、目录、六章正文、返回入口和清晰的键盘文本。该记录是自动化预检，不是 TC-052/053 真人结果。

当前仍需真人完成 TC-052、TC-053，以及 TC-055 真实 20 人研究与规定签署。

**最终判定：AUTOMATION QA = PASS；OVERALL RELEASE = HOLD。**

