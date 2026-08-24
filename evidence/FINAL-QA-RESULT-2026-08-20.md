# QA RESULT — 中文化冻结候选独立复测

## 1. 结论

**项目：**《田园日志》  
**内容版本：** `0.2.0`  
**复测角色：** 独立 QA  
**复测日期：** 2026-08-20（Asia/Dubai）  
**AUTOMATION QA：PASS**  
**整体 RELEASE：HOLD（未签署最终准出）**

当前冻结候选已由独立 QA 完整执行 `npm run verify`，退出码为 `0`。Node 自动化测试 **113/113** 通过；内容、数值、长跑、黄金回放、六策略、构建及证据生成全部通过。本轮专项复核确认界面中文映射完整覆盖 10 个页面、37 种语义命令和 9 组状态/记录域，共 47 个内部值；历史命令日志、损坏导入和只读恢复路径不再向玩家回显内部英文键。本次自动化范围内新发现缺陷为 **S0 0、S1 0、S2 0**。

整体发布仍为 `HOLD`：真人 TC-052 键盘验收、TC-053 真实辅助技术验收及 TC-055 真实 20 人研究均未执行或签署。Chrome 自动化预检只用于降低风险，不能替代这些发布硬门槛。

## 2. 复测对象与环境

- 复测完成时间：2026-08-20 23:49，UTC+04:00。
- 操作系统：Darwin 25.5.0，arm64。
- 运行时：Node.js `v22.23.0`，npm `10.9.8`；PATH 固定到独立 Node 22 运行时。
- Git：仓库没有提交，`HEAD` 不存在；全部项目文件仍为 untracked。本次未提交或推送。
- QA 对产品代码、测试、脚本、`dist/`、协议、结果模板和原始 `docs/` 只读；本报告是 QA 唯一人工改写项。`npm run verify` 按项目流程确定性重建 `dist/` 和生成态证据。

## 3. 完整自动化链

实际执行顺序：

1. `node scripts/check-content.mjs`
2. `node scripts/balance.mjs`
3. `node --test --test-concurrency=1 tests/*.test.mjs`
4. `node scripts/simulate.mjs`
5. `node scripts/build.mjs`
6. `node scripts/generate-evidence.mjs`

| 阶段 | 独立复测结果 |
|---|---|
| 完整 `npm run verify` | **PASS，退出码 0** |
| 内容校验 | PASS；引用、DSL、本地化、叙事与事件约束有效 |
| 数值校验 | PASS |
| Node 自动化 | **113/113 PASS**；fail 0、cancelled 0、skipped 0、todo 0 |
| 测试阶段耗时 | 116721.7315 ms |
| 长跑模拟 | PASS；全部统计违规数为 0 |
| 构建 | PASS；`dist/` 共 30 个文件 |
| 证据生成 | PASS；`evidence_hash` 为 `5119120b845e0c68880b91e45bb0853f685591dc7690ac36c803bfa5f5c35bf9` |

内容规模为 19 作物、10 天气、5 动物、8 配方、8 建筑、8 居民、3 区域和 183 事件；事件分类为农场 40、动物 35、天气 32、居民 48、主线 16、节庆 12。367 个事件选项 ID 的全局唯一性及全部引用、文本键、DSL 和机械效果约束均通过。

长跑结果：天气 10,000 季、事件导演 10,000 日、属性样本 100,000 个、语义命令 100,000 条及幂等检查 1,000 次，违规均为 0；100,000 条命令中实际执行 69,434、预期拒绝 30,566，没有未分类异常。

## 4. 中文化专项核查

### 4.1 映射完备性

QA 未只信任测试名称，而是独立解析 `index.html`、`src/core/engine.js` 与 `src/presentation/labels.js`：

- 页面入口恰有 10 个唯一键，和 `PAGE_SECTION_LABELS` 的 10 个键集合完全一致。
- 引擎语义命令恰有 37 个唯一 `case`，和 `COMMAND_LABELS` 的 37 个键集合完全一致。
- 作物状态、动物生命阶段、疾病、动物效果字段、加工、订单、工程、仓储异常及日志类型共 9 组映射、47 个内部值；所有显示值均含中文。
- 未知页面、命令或状态使用中文兜底，不把未知内部枚举原样显示给玩家。
- `index.html` 已使用“田园日志 / 本机存档”，不存在旧的 `FARM JOURNAL / LOCAL SAVE` 标题；页面眉题不再调用 `page.toUpperCase()`。

完整套件中的 5 个中文化专项测试全部通过：页面/命令集合、状态域、展示层静态防泄漏、常见输入错误，以及损坏状态导入/本机恢复。

### 4.2 可见提示、状态与旧日志

- 命令成功提示由结构化命令类型生成，例如“批量灌溉已完成并保存。”，不显示 `crop.irrigate_batch`。
- 作物、动物、加工、订单、工程和仓储异常均经对应中文标签函数渲染，不直接输出 `growing`、`adult`、`pending` 等内部枚举。
- 历史命令日志按已保存的 `command_type` 重新生成中文摘要，例如“操作记录 / 批量灌溉已提交。”；不信任旧 `entry.message` 中的英文命令 ID。
- 日结记录显示中文摘要，不把内部状态哈希当作玩家文案；迁移物品记录显示中文物品名。
- 事件动物状态字段、已有任务中的稳定内容 ID、运行期田区/动物/圈舍 ID 均在展示层转换为中文名或玩家显示名。

绑定的真实 Chrome 自动化预检报告记录：在最终 `dist/` 上载入已有本机存档并打开全部 10 页后，页面键、37 类命令前缀和已知英文状态枚举的可见文本扫描均为 0 命中；实见“田区管理”“芜菁 · 生长中”“批量灌溉已完成并保存”。该记录是自动化观察，不是 TC-052/053 真人签署。

### 4.3 错误与恢复路径

QA 独立触发四条核心错误路径，实际消息如下：

| 路径 | 玩家可见消息 | 内部字段泄漏 |
|---|---|---|
| 新建存档无效时区 | `请输入有效的 IANA 时区，例如 Asia/Shanghai` | 无 |
| 时区迁移无效时区 | `时区无效，请输入有效的 IANA 时区，例如 Asia/Shanghai` | 无 |
| 损坏 JSON 导入 | `备份文件格式无效，无法读取` | 无 |
| 鸡蛋库存不足 | `物品不足：鸡蛋×1` | 无 `item_egg` |

UI 导入失败固定显示“备份导入失败：文件内容无效或与当前版本不兼容。”；本机状态校验失败固定显示“存档进入只读恢复：状态校验失败，请导出恢复诊断。”。两条 catch 路径不拼接原始异常，因此不会把 `action_id`、`payload`、`save_version`、错误类型或损坏状态字段回显给玩家。

## 5. 存档兼容、黄金回放与核心回归

存档自动化继续通过：v1 双槽原子提交、损坏当前槽回退、导入/迁移前原始备份、内部 v0→v1 迁移、未知及关闭模块字节等价保留、校验和和篡改拒绝、7 个逐日 + 4 个逐周 + 1 个年初共 12 个恢复点，以及真实 5 MiB 配额下五年容量与逐点还原。

本轮中文化位于展示层，没有改写历史存档中的稳定命令 ID、状态枚举或结构化账本字段。历史 `farm-journal-golden-replays-v1` 保留，当前 `farm-journal-golden-replays-v2-current-content-mechanics` 的 7/21/84 日状态与日志哈希均逐字段命中，未分类异常均为 0。

指定核心回归结果：

- `work.remove`：已执行的播种或居民交谈不能通过移除工作退回 WP、专注或资源；执行结果保留，未执行日程仍可在确认前编辑。
- 事件分支：183 个事件的两分支均有不同且可执行的机械效果；双向严格支配检查与退化反例继续通过。
- TC-059：6 类策略 × 3 种子 × 84 日，共 18 局，策略违规 0、免费循环 false、支配策略 null；加工完成 200 批，购畜 6 次（大型动物 3、鸭 3），五物种均覆盖，畜棚完成 3 次；216 个订单生成周，接受/交付各 25 单，迟交付 15 单；四类正常策略平均工时利用率为 50%—76.19%，全部运行未分类异常与未清预留均为 0。

## 6. 发布清单与证据哈希独立复算

QA 使用 Node `crypto` 直接读取实际字节，并以独立实现的递归键排序规范 JSON 计算 SHA-256；未调用产品的 `sha256` 或 `canonicalStringify` 实现。

| 检查 | 结果 |
|---|---|
| manifest 格式 | `farm-journal-release-manifest-v1`，PASS |
| manifest 文件数 / 实际 `dist/` 文件数 | **30 / 30**，路径集合完全一致 |
| bytes / SHA-256 | **30/30 匹配**，无多余或缺失文件 |
| 根入口、README 与全部 `src/` 构建副本 | **30/30 字节一致**，差异 0 |
| manifest `bundle_hash` | `cefa91a9623769fc10eb5492714dd8f560515d0a6fcb2a5fa268f517cc16c61a` |
| 独立复算 `bundle_hash` | 同值，MATCH |
| summary `evidence_hash` | `5119120b845e0c68880b91e45bb0853f685591dc7690ac36c803bfa5f5c35bf9` |
| 独立复算 `evidence_hash` | 同值，MATCH |
| summary 与 manifest 交叉引用 | files=30、bundle_hash 完全一致，PASS |

生成态证据文件 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `evidence/release-manifest.json` | `d011dd6f40a48c67930ff003cd02329c7842ac4185d0b799cec0c967e591dfcf` |
| `evidence/acceptance-summary.json` | `4c38ecebb7c9ff0434a71643b28d00c52943175d1ab51fcd50baafb0c341ee06` |
| `evidence/TC-MAPPING.md` | `a66e05e4fbb1c1c5f40eda58ec940588572bc1485bc503dd87cc197de5ca0539` |

本轮中文展示相关发布文件：

- `index.html`：`c3ba565868b8f68defab6cd4fe499cb68f80e3de0f75096f494a2b2cdb688ad5`
- `src/presentation/app.js`：`d6fe8762e19d72e944866befa5688ccff1e1c17809f70c7472203b00ea967b0b`
- `src/presentation/labels.js`：`cb1cdda9221975bdb038c518dd53d33fe54400fafe9bd8cc58135c314a3708bc`
- `src/presentation/styles.css`：`788ef557e9803d35303c1a6080c8c4e18f295e64c7b2e7cd5b1ec95786e15103`

## 7. 浏览器预检绑定与人工边界

`evidence/TC-052-053-browser-preflight-2026-08-20.md` 的 SHA-256 为：

`6e138ccfb5d9d81314157a8fe6de79b34d6e0eea64158b50571885f48dcc109c`

QA 独立核对该报告内的 30 文件、`bundle_hash`、`index.html`、`app.js` 和 `labels.js` 哈希，均与当前 manifest 完全一致。报告结论明确为 `AUTOMATED PREFLIGHT PASS / HUMAN ACCEPTANCE NOT RUN`，没有把浏览器自动化冒充真人或辅助技术签署。

TC-001—059 映射共有 59 个连续且唯一编号：`automated-passed` 56 项、`browser-manual-pending-QA` 2 项、`external-study-required` 1 项。剩余硬门槛为：

| TC | 当前状态 | 尚需工作 |
|---|---|---|
| TC-052 | **HOLD / NOT RUN** | 真人按 K-01—K-17 全程键盘执行并完成规定签署 |
| TC-053 | **HOLD / NOT RUN** | 真人使用协议规定的真实浏览器 + VoiceOver 或 NVDA 完成 A-01—A-17 并签署 |
| TC-055 | **HOLD / NOT RUN** | 按冻结协议完成 20 名合格真实新手研究，复合成功至少 16/20，并由 QA 与 Game Designer 双签 |

`TC-052-053-results-template.md` 仍为全项 `NOT RUN`，SHA-256 `bf1b8f1925db80b589f5898e1548ca7e7c4187be1d19657e4e13ec9155f3cd58`；`TC-055-results-template.md` 仍为 `not-run` 且 P01—P20 为空，SHA-256 `bb5d81b42f5b7640637f8ef91d774fc1c5ab35ee04d5608ca050f1778b455105`。QA 没有伪造、推断或代签任何人工结果。

## 8. 原始文档完整性

原始 `docs/` 文件保持以下 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `docs/田园日志_详细策划案_V0.2.docx` | `d3d3f52eff04c17bffa5fa29a47313e469c43db2f297bd4206e3e9fc0ece8d30` |
| `docs/田园日志_详细策划案_V0.2.md` | `129c91bd1931346b50adb02cd56ce8a3bfaf0052f851284eef3a7e9e1158b00a` |
| `docs/田园日志_数值验算模型_V0.2.py` | `9ea872611bb7c5861afa3af722b0220280e6a35f519f0c9aa0851420e1ea6cbe` |

## 9. 最终判定

**AUTOMATION QA：PASS。** 当前中文化冻结候选通过完整自动化链、独立发布清单复算、源构建一致性复核、旧存档展示兼容及错误防泄漏专项检查；自动化范围内没有新发现 S0/S1/S2。

**整体 RELEASE：HOLD。** 只有 TC-052、TC-053 和 TC-055 在同一 `bundle_hash` 上完成真实执行、证据记录及规定签署后，项目才可宣布达到最终准出。本报告仅签署自动化 QA，不代签真人键盘、辅助技术或 20 人用户研究。
