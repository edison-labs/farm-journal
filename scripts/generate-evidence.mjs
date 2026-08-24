import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { runBalanceChecks } from "../src/rules/balance.js";
import { runGoldenReplay, simulateSixStrategies } from "../src/core/simulation.js";
import { validateContent } from "../src/content/validate.js";
import { canonicalStringify, sha256 } from "../src/core/utils.js";

const evidence = new URL("../evidence/", import.meta.url);
await mkdir(evidence, { recursive: true });

async function releaseFiles(directory, prefix = "") {
  const output = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = `${prefix}${entry.name}`;
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) output.push(...await releaseFiles(url, `${relativePath}/`));
    else {
      const text = await readFile(url, "utf8");
      output.push({ path: relativePath, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256(text) });
    }
  }
  return output;
}

const content = validateContent();
const balance = runBalanceChecks();
const golden = [7, 21, 84].map((days) => runGoldenReplay(days));
const strategies = simulateSixStrategies();
const historicalBaseline = JSON.parse(await readFile(new URL("../fixtures/golden-replays-v1.json", import.meta.url), "utf8"));
if (historicalBaseline.format !== "farm-journal-golden-replays-v1") throw new Error("历史v1黄金基线缺失或被覆盖");
const baseline = JSON.parse(await readFile(new URL("../fixtures/golden-replays-v2.json", import.meta.url), "utf8"));
for (const replay of golden) {
  const expected = baseline.checkpoints[String(replay.days)];
  if (replay.state_hash !== expected.state_hash || replay.log_hash !== expected.log_hash) throw new Error(`${replay.days}日证据与冻结黄金基线不一致`);
}
const releaseManifest = {
  format: "farm-journal-release-manifest-v1",
  generated_at: "fixed-clock:2026-03-02T05:00:00.000Z",
  files: await releaseFiles(new URL("../dist/", import.meta.url)),
};
releaseManifest.bundle_hash = sha256(canonicalStringify(releaseManifest.files));
const summary = {
  generated_at: "fixed-clock:2026-03-02T05:00:00.000Z",
  runtime: "Node 22 / browser ES2022 modules",
  commands: ["npm run check:content", "npm run balance", "npm test", "npm run simulate", "npm run build", "npm run evidence"],
  content,
  balance: { crops: balance.crops.length, animals: balance.animals.length, recipes: balance.recipes.length, document_pressure_cash: balance.cash_stress, runtime_cash: balance.runtime_cash },
  golden: golden.map(({ days, seed, final_day, cash, state_hash, log_hash, unexpected_errors }) => ({ days, seed, final_day, cash, state_hash, log_hash, unexpected_errors })),
  golden_baselines: { current: baseline.format, historical: historicalBaseline.format, supersedes_reason: baseline.supersedes_reason, first_divergence: baseline.first_divergence },
  strategies: {
    days: strategies.days,
    seeds_per_strategy: strategies.seeds_per_strategy,
    semantic_activity: strategies.semantic_activity,
    cash_ranges: strategies.cash_ranges,
    free_loop_detected: strategies.free_loop_detected,
    dominant_strategy: strategies.dominant_strategy,
    violations: strategies.violations,
    runs: strategies.strategies.map((run) => ({
      strategy: run.strategy,
      seed: run.seed,
      final_day: run.final_day,
      final_real_date_key: run.final_real_date_key,
      cash: run.cash,
      average_work_utilization: run.average_work_utilization,
      target_large_species: run.target_large_species,
      purchased_species: run.purchased_species,
      purchased_species_days: run.purchased_species_days,
      animal_care_days: run.animal_care_days,
      animal_production: run.animal_production,
      sold_items: run.sold_items,
      construction_statuses: run.construction_statuses,
      order_generation_keys: run.order_generation_keys,
      order_records: run.order_records,
      accepted_order_ids: run.accepted_order_ids,
      delivered_order_ids: run.delivered_order_ids,
      delivered_order_source_weeks: run.delivered_order_source_weeks,
      max_active_orders: run.max_active_orders,
      late_orders_created: run.late_orders_created,
      late_orders_delivered: run.late_orders_delivered,
      outstanding_reservations: run.outstanding_reservations,
      unexpected_errors: run.unexpected_errors,
    })),
  },
  release_bundle: { manifest: "release-manifest.json", files: releaseManifest.files.length, bundle_hash: releaseManifest.bundle_hash },
};
summary.evidence_hash = sha256(canonicalStringify(summary));
await writeFile(new URL("acceptance-summary.json", evidence), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(new URL("release-manifest.json", evidence), `${JSON.stringify(releaseManifest, null, 2)}\n`);

const titles = [
  "新存档初始状态", "内容静态校验", "数据驱动扩展", "确定性随机流", "刷新点与历法", "系统时间倒退", "系统时间前跳", "DST与时区", "命令幂等", "日结阶段顺序", "日结崩溃恢复", "事务与资源锁", "WP与专注", "工时超载优先级", "成熟收获宽限", "天气分布与上限", "天气预报", "湿度与灌溉", "肥力与杂草", "作物健康与生长", "作物生命周期", "收获数量", "作物品质", "全作物经济", "圈舍清洁与喂养", "疾病概率", "动物产出与经济", "动物生命周期与保护", "存储隔离与出售箱", "保质期", "满仓并发产出", "加工队列与取消", "配方数值", "销量阶梯价格", "市场与订单", "饲料自动采购与资金保护", "建筑工程", "技能成长", "居民关系", "事件DSL校验", "事件导演约束", "奶牛胀气事件", "探索采集", "日志与报告", "离线1—3日", "离线4—7日", "离线>7日", "原子保存与备份", "相邻版本迁移", "迁移失败恢复", "模块关闭兼容", "键盘核心流程", "纯文字与可访问性", "里程碑内容规模", "新手人工可用性", "数值准出", "属性与运行期不变量", "黄金存档回归", "六类84日策略平衡",
];
const automated = new Set(Array.from({ length: 59 }, (_, index) => index + 1).filter((id) => ![52, 53, 55].includes(id)));
const browser = new Set([52, 53]);
const exactProof = {
  1: "tests/core.test.mjs — TC-001 建档前验证IANA时区、0—8整点刷新并生成关键初始状态",
  2: "tests/content-balance.test.mjs — TC-002/TC-054 内容数量、引用、DSL、文本键与正式正文范围；TC-002/TC-040 内容校验使用传入内容并拒绝重复ID、坏引用/文本键/DSL/概率/长度",
  3: "tests/content-balance.test.mjs — TC-003 稳定ID内容定义由通用校验与事件执行器驱动",
  4: "tests/core.test.mjs — TC-004 RNG同键稳定且系统流隔离；TC-004/TC-056 half-up与SHA-256规范值",
  5: "tests/time-persistence.test.mjs — TC-005 05:00刷新边界与84次有效推进准确进入第2年春1",
  6: "tests/time-persistence.test.mjs — TC-006 小于6小时回拨不推进，达到6小时锁定",
  7: "tests/time-persistence.test.mjs — TC-007 系统时间前跳按牧场日期差推进且同一now不重复推进",
  8: "tests/time-persistence.test.mjs — TC-008 DST按锁定时区日期键推进，不按24小时秒数；TC-008 时区迁移不推进日期并有84牧场日冷却",
  9: "tests/core.test.mjs — TC-009 action_id同载荷幂等、异载荷拒绝；tests/time-persistence.test.mjs — TC-009/TC-048 恢复点保留当时action_id收据窗口和幂等语义",
  10: "tests/core.test.mjs — TC-010/TC-011 十阶段顺序及每个failpoint保持输入前态（阶段顺序断言）",
  11: "tests/core.test.mjs — TC-010/TC-011 十阶段顺序及每个failpoint保持输入前态（十个故障点输入前态断言）",
  12: "tests/systems.test.mjs — TC-012/TC-013/TC-032 当日全部加工队列合计1WP/1专注，失败事务完整回滚；TC-012/TC-029/TC-035 订单预留阻止出售加工双花，放弃时解除",
  13: "tests/systems.test.mjs — TC-013/TC-014 玩家可分配3专注、修改并确认基础日程及覆盖托管优先级；TC-013/TC-037 同工程同日1—4WP合计1专注，跨工程分别计费",
  14: "tests/systems.test.mjs — TC-014 WP超载按医疗>喂养>收获>灌溉>建设>探索，不静默吞任务；TC-014 未来3日工时预测识别三田成熟峰值和宽限错峰建议",
  15: "tests/systems.test.mjs — TC-015 成熟后1日无损宽限，之后每活跃日健康-5并累计延误",
  16: "tests/content-balance.test.mjs — TC-016 四季天气权重各为100；scripts/simulate.mjs — result.weather.seasons=10000、constraint_violations=0且各天气频率偏差不超过±1.5百分点",
  17: "tests/systems.test.mjs — TC-017 气象站使实际预报从3日扩展到7日；TC-017 固定种子10k反证第2/3日预报准确率且失败绝不返回实况",
  18: "tests/systems.test.mjs — TC-018 湿度公式在预测34.999时灌至65、恰35时不灌溉",
  19: "tests/systems.test.mjs — TC-019 肥力低于20与结算后杂草高于60的健康惩罚叠加",
  20: "tests/systems.test.mjs — TC-020 健康20与39日增0.5、健康40日增1，湿度越界停长；TC-018/TC-020 干旱停长时开局信用不会绕过growth_points强制成熟",
  21: "tests/core.test.mjs — TC-021 春1播种在春4成熟，后续节点可落在8/12/16/20；tests/systems.test.mjs — TC-021 季末不足首次成熟拒绝播种且不扣种子/工时；TC-021/TC-024 三叶草收获只转为饲料且不同时生成现金产品",
  22: "tests/systems.test.mjs — TC-022 YieldFactor公式与确定性小数舍入逐项一致",
  23: "tests/systems.test.mjs — TC-023 品质公式各项、倍率边界及每延误日-3精确一致",
  24: "tests/content-balance.test.mjs — TC-024/TC-033/TC-056 数值门槛覆盖全作物、全配方、动物和压力现金流；tests/systems.test.mjs — TC-021/TC-024 三叶草收获只转为饲料且不同时生成现金产品",
  25: "tests/systems.test.mjs — TC-025 圈舍清洁命令与喂养在动物结算前生效；TC-013/TC-025 圈舍工时按鸡鸭舍每舍1WP、大型动物每2只向上取整",
  26: "tests/systems.test.mjs — TC-026/TC-027 初始鸡产出公式0.835，疾病概率与技能修正均clamp；TC-026/TC-028 基础诊疗一次收费80G并锁定两日恢复，玩家命令幂等",
  27: "tests/systems.test.mjs — TC-025/TC-027 动物子顺序喂食后生产，固定种子结果可复现；TC-027 疾病只令生产概率-30个百分点、产品品质-20且不强制停产；TC-027 绵羊首日产出后恰隔7日再次产毛，无冷却off-by-one",
  28: "tests/systems.test.mjs — TC-028 幼体7/14日成长接口与老年仅-15%产出概率；TC-025/TC-028/TC-037 放牧正常天气心情+3，保温/防风抵消对应恶劣天气圈舍惩罚；TC-026/TC-028 基础诊疗一次收费80G并锁定两日恢复，玩家命令幂等",
  29: "tests/systems.test.mjs — TC-029 出售箱日结前可撤回且容量不足拒绝；TC-012/TC-029/TC-035 订单预留阻止出售加工双花，放弃时解除",
  30: "tests/systems.test.mjs — TC-030 保质期在ceil(50%/80%)各扣一次，age>life过期，新产出当日不老化；TC-030/TC-035 临期订单保留品过期后日结成功并转为可补货",
  31: "tests/systems.test.mjs — TC-031 满仓依次出售箱/临时区/异常，产出数量不静默丢失；TC-031 满仓时动物与加工同日完成仍逐项记入异常且总量守恒",
  32: "tests/systems.test.mjs — TC-032 未开始加工全返，已开始只返输入基础价值80%且操作费不退；TC-012/TC-013/TC-032 当日全部加工队列合计1WP/1专注，失败事务完整回滚",
  33: "tests/content-balance.test.mjs — TC-024/TC-033/TC-056 数值门槛覆盖全作物、全配方、动物和压力现金流；tests/systems.test.mjs — TC-012/TC-032/TC-033 加工锁定原料阻止出售/订单双花，8配方均为数据配置",
  34: "tests/content-balance.test.mjs — TC-034 市场分段按单位价half-up，55件base100为5100；tests/systems.test.mjs — TC-034 同物品多品质与订单/普通渠道共享唯一周销量阶梯",
  35: "tests/systems.test.mjs — TC-035 订单生成不超过3个，交付产生快照且不使用唯一物品；TC-012/TC-029/TC-035 订单预留阻止出售加工双花，放弃时解除",
  36: "tests/core.test.mjs — TC-036 托管阶段2先补料：资金1000补7日，资金100仅补当日；tests/systems.test.mjs — TC-036 七日低息周转一次触发、无复利且困难还款不为负",
  37: "tests/systems.test.mjs — TC-037 建设未开工全退；开工退款按剩余WP×80%；TC-013/TC-037 建设每日累计最多4WP且最后一次只扣剩余WP；TC-037 温室启用后创建两块全年且防护恶劣天气的田区",
  38: "tests/systems.test.mjs — TC-038 技能收益：加工费-2%/级、经营订单+1%/级、采集+2%/级概率参数；TC-038 固定大样本采集数量期望每技能等级精确增加2%",
  39: "tests/systems.test.mjs — TC-038/TC-039 技能等级与关系周上限生效；tests/content-balance.test.mjs — resident 48/48事件分支绑定居民且具有不同的真实机械效果",
  40: "tests/content-balance.test.mjs — TC-002/TC-040 内容校验使用传入内容并拒绝重复ID、坏引用/文本键/DSL/概率/长度；tests/systems.test.mjs — TC-012/TC-037/TC-040 DSL启动建设复用锁款、前置与并发规则",
  41: "tests/systems.test.mjs — TC-041 事件导演每日预算≤6、选择≤3、紧急≤1；TC-041/TC-044 事件无候选时生成无选择生活日志；scripts/simulate.mjs — result.events.days=10000、violations=0",
  42: "tests/systems.test.mjs — TC-042 event_cow_bloat_01兽医分支320G、健康+15、延迟因果可追溯",
  43: "tests/systems.test.mjs — TC-043 探索2WP/1专注、每日每区域一次并产生2—4件；TC-043 固定种子探索命中区域事件后返回可读正文、选项并可执行",
  44: "tests/systems.test.mjs — TC-044 四层日志由真实命令与日结写入；TC-044 结构化账本可从初始资金重算现金；TC-044 周报含当日工时且长期归档后年度账本仍可重算",
  45: "tests/core.test.mjs — TC-045 离线1—3日全部逐日活跃结算且结果可复现",
  46: "tests/core.test.mjs — TC-046 离线4—7日安全托管但不进入冻结",
  47: "tests/core.test.mjs — TC-047 离线超过7日只模拟7日，其余日期休整推进；TC-047 冻结期顺延订单/事件/延迟效果且跨年不伪造活跃报告；tests/time-persistence.test.mjs — TC-047 >7日只活跃模拟7日且同一now重复打开不再模拟",
  48: "tests/time-persistence.test.mjs — TC-048 双槽提交指针在故障时保留完整旧态；TC-048 损坏当前槽回退另一完整槽；TC-048 导入前完整提交槽原始备份不会被连续自动保存覆盖；TC-048 真实5MiB双槽加受限原始备份可保存5年并逐点恢复",
  49: "tests/time-persistence.test.mjs — TC-049 内部预发布v0→v1迁移并保留未知模块",
  50: "tests/time-persistence.test.mjs — TC-050 迁移失败先持久备份且原槽字节完全不变；TC-050 导出导入校验和及篡改拒绝",
  51: "tests/time-persistence.test.mjs — TC-051 未知及关闭模块日结、导出导入前后字节等价保留",
  54: "tests/content-balance.test.mjs — TC-002/TC-054 内容数量、引用、DSL、文本键与正式正文范围（19作物、10天气、5动物、8配方、8建筑、8居民、3区域、183事件）",
  56: "tests/content-balance.test.mjs — TC-024/TC-033/TC-056 数值门槛覆盖全作物、全配方、动物和压力现金流；tests/core.test.mjs — TC-004/TC-056 half-up与SHA-256规范值",
  57: "scripts/simulate.mjs — result.invariants.samples=100000、semantic_commands=100000、idempotency_checks=1000、violations=0",
  58: "tests/golden-replay.test.mjs — v1历史基线与v2当前内容机械基线共存；当前7/21/84日回放逐字段命中v2，首次分歧元数据定位day2 resident事件",
  59: "tests/simulation.test.mjs — TC-059 六类策略以真实语义命令稳定运行84日；evidence/acceptance-summary.json — strategies.runs逐局记录购畜、畜棚、生产、订单、工时与异常字段",
};
for (const id of automated) if (!exactProof[id]) throw new Error(`TC-${String(id).padStart(3, "0")} 缺少精确自动化证据映射`);
const pendingProof = {
  52: "tests/ui-static.test.mjs — TC-052 数字键只聚焦可见按钮并等待Enter，模态暂停全局快捷键（静态回归）；dist/index.html 真实浏览器键盘验收仍待签署",
  53: "tests/ui-static.test.mjs — TC-053 应用内减少动态设置独立于系统偏好生效（静态回归）；dist/index.html 真实浏览器与辅助技术验收仍待签署",
};
const lines = ["# TC-001—059 验收映射", "", "| TC | 标题 | 状态 | 证据 |", "|---|---|---|---|"];
for (let index = 0; index < titles.length; index += 1) {
  const id = index + 1;
  const code = `TC-${String(id).padStart(3, "0")}`;
  const status = automated.has(id) ? "automated-passed" : browser.has(id) ? "browser-manual-pending-QA" : "external-study-required";
  const proof = automated.has(id) ? exactProof[id] : browser.has(id) ? pendingProof[id] : "evidence/TC-055-usability-protocol.md；真实20人研究与双签尚未执行，未伪造受试者结论";
  lines.push(`| ${code} | ${titles[index]} | ${status} | ${proof} |`);
}
await writeFile(new URL("TC-MAPPING.md", evidence), `${lines.join("\n")}\n`);
await writeFile(new URL("TC-055-usability-protocol.md", evidence), `# TC-055 新手可用性受试协议

状态：external-study-required。协议版本：1.0。本文只定义真实 20 人研究，不包含、推断或伪造任何受试者结果。

## 预注册与样本

- 冻结协议版本、本协议最终字节的 SHA-256、最终 \`release-manifest.json\` 的 \`bundle_hash\`、浏览器/操作系统版本、视口、时区和刷新点后再招募。
- 招募 20 名有效、成年、首次接触《田园日志》且未阅读项目材料的独立真人；开发者、评审者和重复参加者不计入。
- 技术故障、退出和排除规则在收集前登记；排除者保留记录并补招，不得因结果不利而事后移出分母。
- 录屏、录音和原话记录必须另行取得同意；个人信息与原始媒体存放在受控位置，不进入本仓库。

## 主结果与通过门槛

同一名受试者只有在不阅读外部说明、未获得操作路线提示的情况下同时完成以下三项，复合结果才记为成功：

1. 首次播种：最终存档出现由受试者播种的作物。
2. 首次工作调整：新增、移除或修改至少一项自定义工作/托管优先级并确认日程；只点击“确认”不算调整。
3. 首次出售：把自产产品放入出售箱，并在后续日结看到对应到账记录。

20 名有效受试者中复合成功人数至少 16（80%）才通过。三项不得分别统计 16/20 后拼接结论；接受玩法提示的会话保留在分母并记为主结果失败。

## 中立任务脚本

只描述目标，不告知页面、控件名称或点击路径：创建农场；了解今日状态；种下一批作物；按自己的安排调整并确认工作；处理需要灌溉的田区；查看一种商品的实际报价；让自产产品完成一次出售和到账；关闭并重新打开后确认进度仍在。

研究员只可处理浏览器崩溃、网络/静态服务器不可用等技术问题。任何关于菜单位置、规则或下一步操作的提示须逐字记录，并使该受试者的主结果记为失败，但会话可继续用于定性访谈。

## 跨日执行

- 推荐真实跨日：首场完成建档、播种和工作调整；后续每个刷新点后用同一独立浏览器配置重新打开，等待自产产品、入箱，并在下一刷新点核对到账。
- 若使用受控测试时钟，仍须运行完全相同的最终 \`dist\`；只在标签关闭期间把系统时间单调推进一个牧场日，再重新打开，让生产代码自行同步。不得注入库存、直接调用内部命令或预填完成状态。
- 受控时钟开始前须与一次真实跨日流程做等价校准，并记录每次跳转。随机日没有可出售产品时继续推进；等待时间不计为受试者失败或操作耗时。

## 逐人记录

记录匿名 ID、入组资格、同意状态、协议版本、发布包哈希、环境、跨日模式、每项任务起止时间和完成/失败、是否求助、提示原文、操作错误、误解原话、严重度、技术故障、偏差、退出/排除原因，以及导出存档中用于证明播种/工作调整/销售到账的命令回执或账本摘要。

## 汇总与签署

使用独立的 \`TC-055-results\` 报告列出 20 人三项二进制结果与复合结果、成功比例、偏差和原始数据摘要哈希。QA 与 game designer 必须签署姓名、角色、日期、协议版本、协议文件 SHA-256、最终 \`bundle_hash\` 和结论。代码、构建或协议字节变化后旧签署失效。

自动化脚本、AI 代理、模拟策略、DOM/无障碍扫描和重复运行均不能计入 20 人。本仓库在真实数据和双签名前不得把 TC-055 标为通过。
`);
console.log(JSON.stringify({ status: "passed", files: ["evidence/acceptance-summary.json", "evidence/release-manifest.json", "evidence/TC-MAPPING.md", "evidence/TC-055-usability-protocol.md"], evidence_hash: summary.evidence_hash }, null, 2));
