export const PAGE_SECTION_LABELS = Object.freeze({
  today: "先看看今天",
  plots: "种地",
  animals: "照顾动物",
  warehouse: "收好和卖出",
  processing: "做成商品",
  market: "买卖和订单",
  town: "聊天、探索、建设",
  tasks: "要办的事",
  logs: "最近发生的事",
  settings: "按你的习惯来",
});

export const COMMAND_LABELS = Object.freeze({
  "crop.plant": "播种",
  "crop.harvest": "收获",
  "crop.irrigate": "灌溉",
  "crop.irrigate_batch": "批量灌溉",
  "crop.weed": "除草",
  "crop.fertilize": "施肥",
  "market.buy_seed": "购买种子",
  "market.buy_feed": "购买饲料",
  "inventory.sell": "放入出售箱",
  "inventory.retract_sale": "撤回出售",
  "housing.clean": "清理圈舍",
  "housing.graze": "去放牧",
  "animal.interact": "陪伴动物",
  "animal.treat": "治疗动物",
  "animal.buy": "购买动物",
  "animal.sell": "送走动物",
  "processing.queue": "开始加工",
  "processing.cancel": "取消加工",
  "building.start": "开始建设",
  "building.invest": "投入工时",
  "building.cancel": "取消建设",
  "order.accept": "接受订单",
  "order.reserve": "给订单补货",
  "order.deliver": "交付订单",
  "order.abandon": "放弃订单",
  "exploration.run": "探索",
  "resident.talk": "和居民聊天",
  "resident.gift": "送礼物",
  "event.choose": "做出选择",
  "finance.accept_bridge": "接受七日周转",
  "finance.decline_bridge": "暂不使用七日周转",
  "work.assign": "添加工作",
  "work.remove": "移除工作",
  "work.confirm": "确认安排",
  "work.set_priority": "保存托管顺序",
  "settings.update": "保存设置",
  "timezone.migrate": "更改时区",
});

export const CROP_STATUS_LABELS = Object.freeze({
  growing: "生长中",
  mature: "已成熟",
  grace: "收获宽限期",
  overripe: "已过熟",
});

export const ANIMAL_LIFE_STAGE_LABELS = Object.freeze({
  juvenile: "幼年",
  growing: "成长期",
  adult: "成年",
  elderly: "老年",
});

export const ILLNESS_LABELS = Object.freeze({
  illness_general: "一般不适",
});

export const ANIMAL_STATE_FIELD_LABELS = Object.freeze({
  health: "健康",
  mood: "心情",
  affinity: "亲密",
  satiety: "饱食",
});

export const PROCESSING_STATUS_LABELS = Object.freeze({
  pending: "等待加工",
  started: "加工中",
  complete: "已完成",
  cancelled: "已取消",
});

export const ORDER_STATUS_LABELS = Object.freeze({
  offered: "待接受",
  accepted: "已接受",
  complete: "已完成",
  abandoned: "已放弃",
  expired: "已过期",
});

export const CONSTRUCTION_STATUS_LABELS = Object.freeze({
  planned: "已规划",
  started: "施工中",
  ready: "待次日启用",
  complete: "已完成",
  cancelled: "已取消",
});

export const INVENTORY_ANOMALY_STATUS_LABELS = Object.freeze({
  must_resolve: "待处理",
  resolved: "已处理",
});

export const LEDGER_TYPE_LABELS = Object.freeze({
  command: "操作记录",
  expense: "支出记录",
  sale_settlement: "出售结算",
  daily_report: "经营日报",
  life_log: "生活日志",
  decision: "事件选择",
  effect_log: "效果记录",
  scheduled_effect: "延迟效果",
  scheduled_funds: "延迟资金",
  inventory_expired: "库存过期",
  animal_transfer: "动物转让",
  assistance_receipt: "周转到账",
  assistance_declined: "暂不周转",
  assistance_repayment: "周转还款",
  rest_freeze: "休整记录",
  timezone_migration: "时区迁移",
  migration: "存档迁移",
  migration_item_replacement: "迁移物品替换",
});

function translated(labels, value, fallback) {
  return labels[value] ?? fallback;
}

export function pageSectionLabel(value) { return translated(PAGE_SECTION_LABELS, value, "游戏页面"); }
export function commandLabel(value) { return translated(COMMAND_LABELS, value, "操作"); }
export function cropStatusLabel(value) { return translated(CROP_STATUS_LABELS, value, "状态待确认"); }
export function animalLifeStageLabel(value) { return translated(ANIMAL_LIFE_STAGE_LABELS, value, "阶段待确认"); }
export function illnessLabel(value) { return translated(ILLNESS_LABELS, value, "身体不适"); }
export function animalStateFieldLabel(value) { return translated(ANIMAL_STATE_FIELD_LABELS, value, "状态"); }
export function processingStatusLabel(value) { return translated(PROCESSING_STATUS_LABELS, value, "状态待确认"); }
export function orderStatusLabel(value) { return translated(ORDER_STATUS_LABELS, value, "状态待确认"); }
export function constructionStatusLabel(value) { return translated(CONSTRUCTION_STATUS_LABELS, value, "状态待确认"); }
export function inventoryAnomalyStatusLabel(value) { return translated(INVENTORY_ANOMALY_STATUS_LABELS, value, "待处理"); }
export function ledgerTypeLabel(value) { return translated(LEDGER_TYPE_LABELS, value, "系统记录"); }
