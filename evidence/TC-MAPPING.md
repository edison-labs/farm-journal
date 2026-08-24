# TC-001—059 验收映射

| TC | 标题 | 状态 | 证据 |
|---|---|---|---|
| TC-001 | 新存档初始状态 | automated-passed | tests/core.test.mjs — TC-001 建档前验证IANA时区、0—8整点刷新并生成关键初始状态 |
| TC-002 | 内容静态校验 | automated-passed | tests/content-balance.test.mjs — TC-002/TC-054 内容数量、引用、DSL、文本键与正式正文范围；TC-002/TC-040 内容校验使用传入内容并拒绝重复ID、坏引用/文本键/DSL/概率/长度 |
| TC-003 | 数据驱动扩展 | automated-passed | tests/content-balance.test.mjs — TC-003 稳定ID内容定义由通用校验与事件执行器驱动 |
| TC-004 | 确定性随机流 | automated-passed | tests/core.test.mjs — TC-004 RNG同键稳定且系统流隔离；TC-004/TC-056 half-up与SHA-256规范值 |
| TC-005 | 刷新点与历法 | automated-passed | tests/time-persistence.test.mjs — TC-005 05:00刷新边界与84次有效推进准确进入第2年春1 |
| TC-006 | 系统时间倒退 | automated-passed | tests/time-persistence.test.mjs — TC-006 小于6小时回拨不推进，达到6小时锁定 |
| TC-007 | 系统时间前跳 | automated-passed | tests/time-persistence.test.mjs — TC-007 系统时间前跳按牧场日期差推进且同一now不重复推进 |
| TC-008 | DST与时区 | automated-passed | tests/time-persistence.test.mjs — TC-008 DST按锁定时区日期键推进，不按24小时秒数；TC-008 时区迁移不推进日期并有84牧场日冷却 |
| TC-009 | 命令幂等 | automated-passed | tests/core.test.mjs — TC-009 action_id同载荷幂等、异载荷拒绝；tests/time-persistence.test.mjs — TC-009/TC-048 恢复点保留当时action_id收据窗口和幂等语义 |
| TC-010 | 日结阶段顺序 | automated-passed | tests/core.test.mjs — TC-010/TC-011 十阶段顺序及每个failpoint保持输入前态（阶段顺序断言） |
| TC-011 | 日结崩溃恢复 | automated-passed | tests/core.test.mjs — TC-010/TC-011 十阶段顺序及每个failpoint保持输入前态（十个故障点输入前态断言） |
| TC-012 | 事务与资源锁 | automated-passed | tests/systems.test.mjs — TC-012/TC-013/TC-032 当日全部加工队列合计1WP/1专注，失败事务完整回滚；TC-012/TC-029/TC-035 订单预留阻止出售加工双花，放弃时解除 |
| TC-013 | WP与专注 | automated-passed | tests/systems.test.mjs — TC-013/TC-014 玩家可分配3专注、修改并确认基础日程及覆盖托管优先级；TC-013/TC-037 同工程同日1—4WP合计1专注，跨工程分别计费 |
| TC-014 | 工时超载优先级 | automated-passed | tests/systems.test.mjs — TC-014 WP超载按医疗>喂养>收获>灌溉>建设>探索，不静默吞任务；TC-014 未来3日工时预测识别三田成熟峰值和宽限错峰建议 |
| TC-015 | 成熟收获宽限 | automated-passed | tests/systems.test.mjs — TC-015 成熟后1日无损宽限，之后每活跃日健康-5并累计延误 |
| TC-016 | 天气分布与上限 | automated-passed | tests/content-balance.test.mjs — TC-016 四季天气权重各为100；scripts/simulate.mjs — result.weather.seasons=10000、constraint_violations=0且各天气频率偏差不超过±1.5百分点 |
| TC-017 | 天气预报 | automated-passed | tests/systems.test.mjs — TC-017 气象站使实际预报从3日扩展到7日；TC-017 固定种子10k反证第2/3日预报准确率且失败绝不返回实况 |
| TC-018 | 湿度与灌溉 | automated-passed | tests/systems.test.mjs — TC-018 湿度公式在预测34.999时灌至65、恰35时不灌溉 |
| TC-019 | 肥力与杂草 | automated-passed | tests/systems.test.mjs — TC-019 肥力低于20与结算后杂草高于60的健康惩罚叠加 |
| TC-020 | 作物健康与生长 | automated-passed | tests/systems.test.mjs — TC-020 健康20与39日增0.5、健康40日增1，湿度越界停长；TC-018/TC-020 干旱停长时开局信用不会绕过growth_points强制成熟 |
| TC-021 | 作物生命周期 | automated-passed | tests/core.test.mjs — TC-021 春1播种在春4成熟，后续节点可落在8/12/16/20；tests/systems.test.mjs — TC-021 季末不足首次成熟拒绝播种且不扣种子/工时；TC-021/TC-024 三叶草收获只转为饲料且不同时生成现金产品 |
| TC-022 | 收获数量 | automated-passed | tests/systems.test.mjs — TC-022 YieldFactor公式与确定性小数舍入逐项一致 |
| TC-023 | 作物品质 | automated-passed | tests/systems.test.mjs — TC-023 品质公式各项、倍率边界及每延误日-3精确一致 |
| TC-024 | 全作物经济 | automated-passed | tests/content-balance.test.mjs — TC-024/TC-033/TC-056 数值门槛覆盖全作物、全配方、动物和压力现金流；tests/systems.test.mjs — TC-021/TC-024 三叶草收获只转为饲料且不同时生成现金产品 |
| TC-025 | 圈舍清洁与喂养 | automated-passed | tests/systems.test.mjs — TC-025 圈舍清洁命令与喂养在动物结算前生效；TC-013/TC-025 圈舍工时按鸡鸭舍每舍1WP、大型动物每2只向上取整 |
| TC-026 | 疾病概率 | automated-passed | tests/systems.test.mjs — TC-026/TC-027 初始鸡产出公式0.835，疾病概率与技能修正均clamp；TC-026/TC-028 基础诊疗一次收费80G并锁定两日恢复，玩家命令幂等 |
| TC-027 | 动物产出与经济 | automated-passed | tests/systems.test.mjs — TC-025/TC-027 动物子顺序喂食后生产，固定种子结果可复现；TC-027 疾病只令生产概率-30个百分点、产品品质-20且不强制停产；TC-027 绵羊首日产出后恰隔7日再次产毛，无冷却off-by-one |
| TC-028 | 动物生命周期与保护 | automated-passed | tests/systems.test.mjs — TC-028 幼体7/14日成长接口与老年仅-15%产出概率；TC-025/TC-028/TC-037 放牧正常天气心情+3，保温/防风抵消对应恶劣天气圈舍惩罚；TC-026/TC-028 基础诊疗一次收费80G并锁定两日恢复，玩家命令幂等 |
| TC-029 | 存储隔离与出售箱 | automated-passed | tests/systems.test.mjs — TC-029 出售箱日结前可撤回且容量不足拒绝；TC-012/TC-029/TC-035 订单预留阻止出售加工双花，放弃时解除 |
| TC-030 | 保质期 | automated-passed | tests/systems.test.mjs — TC-030 保质期在ceil(50%/80%)各扣一次，age>life过期，新产出当日不老化；TC-030/TC-035 临期订单保留品过期后日结成功并转为可补货 |
| TC-031 | 满仓并发产出 | automated-passed | tests/systems.test.mjs — TC-031 满仓依次出售箱/临时区/异常，产出数量不静默丢失；TC-031 满仓时动物与加工同日完成仍逐项记入异常且总量守恒 |
| TC-032 | 加工队列与取消 | automated-passed | tests/systems.test.mjs — TC-032 未开始加工全返，已开始只返输入基础价值80%且操作费不退；TC-012/TC-013/TC-032 当日全部加工队列合计1WP/1专注，失败事务完整回滚 |
| TC-033 | 配方数值 | automated-passed | tests/content-balance.test.mjs — TC-024/TC-033/TC-056 数值门槛覆盖全作物、全配方、动物和压力现金流；tests/systems.test.mjs — TC-012/TC-032/TC-033 加工锁定原料阻止出售/订单双花，8配方均为数据配置 |
| TC-034 | 销量阶梯价格 | automated-passed | tests/content-balance.test.mjs — TC-034 市场分段按单位价half-up，55件base100为5100；tests/systems.test.mjs — TC-034 同物品多品质与订单/普通渠道共享唯一周销量阶梯 |
| TC-035 | 市场与订单 | automated-passed | tests/systems.test.mjs — TC-035 订单生成不超过3个，交付产生快照且不使用唯一物品；TC-012/TC-029/TC-035 订单预留阻止出售加工双花，放弃时解除 |
| TC-036 | 饲料自动采购与资金保护 | automated-passed | tests/core.test.mjs — TC-036 托管阶段2先补料：资金1000补7日，资金100仅补当日；tests/systems.test.mjs — TC-036 七日低息周转一次触发、无复利且困难还款不为负 |
| TC-037 | 建筑工程 | automated-passed | tests/systems.test.mjs — TC-037 建设未开工全退；开工退款按剩余WP×80%；TC-013/TC-037 建设每日累计最多4WP且最后一次只扣剩余WP；TC-037 温室启用后创建两块全年且防护恶劣天气的田区 |
| TC-038 | 技能成长 | automated-passed | tests/systems.test.mjs — TC-038 技能收益：加工费-2%/级、经营订单+1%/级、采集+2%/级概率参数；TC-038 固定大样本采集数量期望每技能等级精确增加2% |
| TC-039 | 居民关系 | automated-passed | tests/systems.test.mjs — TC-038/TC-039 技能等级与关系周上限生效；tests/content-balance.test.mjs — resident 48/48事件分支绑定居民且具有不同的真实机械效果 |
| TC-040 | 事件DSL校验 | automated-passed | tests/content-balance.test.mjs — TC-002/TC-040 内容校验使用传入内容并拒绝重复ID、坏引用/文本键/DSL/概率/长度；tests/systems.test.mjs — TC-012/TC-037/TC-040 DSL启动建设复用锁款、前置与并发规则 |
| TC-041 | 事件导演约束 | automated-passed | tests/systems.test.mjs — TC-041 事件导演每日预算≤6、选择≤3、紧急≤1；TC-041/TC-044 事件无候选时生成无选择生活日志；scripts/simulate.mjs — result.events.days=10000、violations=0 |
| TC-042 | 奶牛胀气事件 | automated-passed | tests/systems.test.mjs — TC-042 event_cow_bloat_01兽医分支320G、健康+15、延迟因果可追溯 |
| TC-043 | 探索采集 | automated-passed | tests/systems.test.mjs — TC-043 探索2WP/1专注、每日每区域一次并产生2—4件；TC-043 固定种子探索命中区域事件后返回可读正文、选项并可执行 |
| TC-044 | 日志与报告 | automated-passed | tests/systems.test.mjs — TC-044 四层日志由真实命令与日结写入；TC-044 结构化账本可从初始资金重算现金；TC-044 周报含当日工时且长期归档后年度账本仍可重算 |
| TC-045 | 离线1—3日 | automated-passed | tests/core.test.mjs — TC-045 离线1—3日全部逐日活跃结算且结果可复现 |
| TC-046 | 离线4—7日 | automated-passed | tests/core.test.mjs — TC-046 离线4—7日安全托管但不进入冻结 |
| TC-047 | 离线>7日 | automated-passed | tests/core.test.mjs — TC-047 离线超过7日只模拟7日，其余日期休整推进；TC-047 冻结期顺延订单/事件/延迟效果且跨年不伪造活跃报告；tests/time-persistence.test.mjs — TC-047 >7日只活跃模拟7日且同一now重复打开不再模拟 |
| TC-048 | 原子保存与备份 | automated-passed | tests/time-persistence.test.mjs — TC-048 双槽提交指针在故障时保留完整旧态；TC-048 损坏当前槽回退另一完整槽；TC-048 导入前完整提交槽原始备份不会被连续自动保存覆盖；TC-048 真实5MiB双槽加受限原始备份可保存5年并逐点恢复 |
| TC-049 | 相邻版本迁移 | automated-passed | tests/time-persistence.test.mjs — TC-049 内部预发布v0→v1迁移并保留未知模块 |
| TC-050 | 迁移失败恢复 | automated-passed | tests/time-persistence.test.mjs — TC-050 迁移失败先持久备份且原槽字节完全不变；TC-050 导出导入校验和及篡改拒绝 |
| TC-051 | 模块关闭兼容 | automated-passed | tests/time-persistence.test.mjs — TC-051 未知及关闭模块日结、导出导入前后字节等价保留 |
| TC-052 | 键盘核心流程 | browser-manual-pending-QA | tests/ui-static.test.mjs — TC-052 数字键只聚焦可见按钮并等待Enter，模态暂停全局快捷键（静态回归）；dist/index.html 真实浏览器键盘验收仍待签署 |
| TC-053 | 纯文字与可访问性 | browser-manual-pending-QA | tests/ui-static.test.mjs — TC-053 应用内减少动态设置独立于系统偏好生效（静态回归）；dist/index.html 真实浏览器与辅助技术验收仍待签署 |
| TC-054 | 里程碑内容规模 | automated-passed | tests/content-balance.test.mjs — TC-002/TC-054 内容数量、引用、DSL、文本键与正式正文范围（19作物、10天气、5动物、8配方、8建筑、8居民、3区域、183事件） |
| TC-055 | 新手人工可用性 | external-study-required | evidence/TC-055-usability-protocol.md；真实20人研究与双签尚未执行，未伪造受试者结论 |
| TC-056 | 数值准出 | automated-passed | tests/content-balance.test.mjs — TC-024/TC-033/TC-056 数值门槛覆盖全作物、全配方、动物和压力现金流；tests/core.test.mjs — TC-004/TC-056 half-up与SHA-256规范值 |
| TC-057 | 属性与运行期不变量 | automated-passed | scripts/simulate.mjs — result.invariants.samples=100000、semantic_commands=100000、idempotency_checks=1000、violations=0 |
| TC-058 | 黄金存档回归 | automated-passed | tests/golden-replay.test.mjs — v1历史基线与v2当前内容机械基线共存；当前7/21/84日回放逐字段命中v2，首次分歧元数据定位day2 resident事件 |
| TC-059 | 六类84日策略平衡 | automated-passed | tests/simulation.test.mjs — TC-059 六类策略以真实语义命令稳定运行84日；evidence/acceptance-summary.json — strategies.runs逐局记录购畜、畜棚、生产、订单、工时与异常字段 |
