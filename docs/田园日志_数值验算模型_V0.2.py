from __future__ import annotations

from dataclasses import dataclass
from math import floor


SEASON_DAYS = 21
PLOT_CELLS = 12
FERTILITY_REPLACEMENT_COST_PER_POINT = 3


@dataclass(frozen=True)
class Crop:
    crop_id: str
    name: str
    season: str
    seed_price: int
    growth_days: int
    regrow_days: int | None
    yield_per_cell: float
    sell_price: int
    fertility_cost: int
    care_load: float
    risk: str

    @property
    def harvests(self) -> int:
        if self.regrow_days:
            return 1 + floor((SEASON_DAYS - self.growth_days) / self.regrow_days)
        return floor(SEASON_DAYS / self.growth_days)

    @property
    def gross_per_plot(self) -> float:
        return self.harvests * PLOT_CELLS * self.yield_per_cell * self.sell_price

    @property
    def seed_cost_per_plot(self) -> float:
        purchases = 1 if self.regrow_days else self.harvests
        return purchases * PLOT_CELLS * self.seed_price

    @property
    def fertility_reserve_cost(self) -> float:
        return self.harvests * self.fertility_cost * FERTILITY_REPLACEMENT_COST_PER_POINT

    @property
    def net_per_plot(self) -> float:
        return self.gross_per_plot - self.seed_cost_per_plot - self.fertility_reserve_cost

    @property
    def work_points_per_plot(self) -> float:
        operations = (1 + self.harvests) if self.regrow_days else (2 * self.harvests)
        routine_share = SEASON_DAYS * self.care_load / 2
        return operations + routine_share


CROPS = [
    Crop("crop_turnip", "芜菁", "春", 25, 4, None, 1.0, 48, 4, 1.0, "低"),
    Crop("crop_potato", "土豆", "春", 35, 6, None, 1.25, 75, 6, 1.0, "中"),
    Crop("crop_wheat_s", "春小麦", "春", 20, 5, None, 1.0, 44, 4, 0.8, "低"),
    Crop("crop_cabbage", "卷心菜", "春", 65, 9, None, 1.0, 150, 12, 1.5, "高"),
    Crop("crop_strawberry", "草莓", "春", 140, 8, 4, 1.0, 72, 4, 1.3, "中"),
    Crop("crop_clover", "三叶草", "春", 15, 6, 3, 2.0, 10, 0, 0.6, "低"),
    Crop("crop_cucumber", "黄瓜", "夏", 50, 6, 4, 1.0, 50, 5, 1.0, "中"),
    Crop("crop_tomato", "番茄", "夏", 110, 8, 4, 1.0, 70, 6, 1.4, "高"),
    Crop("crop_corn", "玉米", "夏", 100, 10, 5, 1.5, 55, 8, 0.9, "低"),
    Crop("crop_melon", "甜瓜", "夏", 140, 10, None, 1.0, 230, 14, 1.5, "高"),
    Crop("crop_soybean", "大豆", "夏", 35, 6, None, 2.0, 35, 0, 0.8, "低"),
    Crop("crop_carrot", "胡萝卜", "秋", 35, 5, None, 1.0, 70, 4, 0.9, "低"),
    Crop("crop_pumpkin", "南瓜", "秋", 90, 10, None, 1.0, 180, 15, 1.4, "高"),
    Crop("crop_sweet_potato", "红薯", "秋", 70, 7, 5, 1.5, 52, 7, 1.0, "中"),
    Crop("crop_beet", "甜菜", "秋", 45, 6, None, 1.0, 90, 6, 1.0, "中"),
    Crop("crop_winter_wheat", "冬小麦", "冬", 25, 7, None, 1.0, 60, 4, 0.7, "低"),
    Crop("crop_radish", "冬萝卜", "冬", 45, 6, None, 1.0, 95, 6, 0.9, "低"),
    Crop("crop_kale", "羽衣甘蓝", "冬", 60, 7, 5, 1.0, 75, 6, 1.2, "中"),
    Crop("crop_onion", "洋葱", "冬", 40, 6, None, 1.0, 85, 6, 0.8, "低"),
]


@dataclass(frozen=True)
class Animal:
    animal_id: str
    name: str
    purchase: int
    feed_units_day: float
    product_units: float
    production_probability: float
    product_price: int
    production_period_days: int = 1

    @property
    def daily_feed_cost(self) -> float:
        return self.feed_units_day * 10

    @property
    def expected_daily_gross(self) -> float:
        return (
            self.product_units
            * self.production_probability
            * self.product_price
            / self.production_period_days
        )

    @property
    def expected_daily_net(self) -> float:
        return self.expected_daily_gross - self.daily_feed_cost

    @property
    def payback_days(self) -> float:
        return self.purchase / self.expected_daily_net


ANIMALS = [
    Animal("animal_chicken", "鸡", 600, 1, 1, 0.85, 32),
    Animal("animal_duck", "鸭", 900, 1, 1, 0.72, 45),
    Animal("animal_cow", "奶牛", 4800, 3, 3, 0.90, 55),
    Animal("animal_goat", "山羊", 3600, 2, 2, 0.90, 65),
    Animal("animal_sheep", "绵羊", 3200, 2, 5, 1.00, 95, 7),
]


@dataclass(frozen=True)
class Recipe:
    recipe_id: str
    name: str
    input_value: int
    output_value: int
    operation_cost: int

    @property
    def uplift(self) -> int:
        return self.output_value - self.input_value - self.operation_cost

    @property
    def uplift_rate(self) -> float:
        return self.uplift / self.input_value


RECIPES = [
    Recipe("recipe_mayo", "蛋黄酱（2蛋→1）", 64, 90, 6),
    Recipe("recipe_cheese", "奶酪（3奶→1）", 165, 220, 12),
    Recipe("recipe_yogurt", "酸奶（2奶→2）", 110, 130, 8),
    Recipe("recipe_flour", "面粉（3麦→2）", 132, 160, 8),
    Recipe("recipe_bread", "面包（2面粉→3）", 160, 186, 10),
    Recipe("recipe_jam", "果酱（3草莓→2）", 216, 250, 10),
    Recipe("recipe_pickle", "腌菜（3黄瓜→2）", 150, 190, 10),
    Recipe("recipe_yarn", "毛线（2羊毛→3）", 190, 225, 10),
]


def first_season_cash(yield_factor: float = 1.0, hen_lay_rate: float = 0.85) -> dict[str, float]:
    start_cash = 2400
    hens = 3
    feed_cost = hens * 10 * SEASON_DAYS
    egg_gross = hens * hen_lay_rate * 32 * SEASON_DAYS
    upkeep = 20 * SEASON_DAYS
    # Five turnip harvests; the first twelve seeds are granted, four replants are purchased.
    crop_gross = 5 * PLOT_CELLS * yield_factor * 48
    crop_seed_cost = 4 * PLOT_CELLS * 25
    fertilizer_reserve = 5 * 4 * 3
    ending_cash = (
        start_cash
        + crop_gross
        + egg_gross
        - crop_seed_cost
        - fertilizer_reserve
        - feed_cost
        - upkeep
    )
    return {
        "start_cash": start_cash,
        "crop_gross": crop_gross,
        "egg_gross": egg_gross,
        "seed_cost": crop_seed_cost,
        "fertility_reserve": fertilizer_reserve,
        "feed_cost": feed_cost,
        "upkeep": upkeep,
        "ending_cash": ending_cash,
        "net_change": ending_cash - start_cash,
    }


def workload_scenarios() -> list[dict[str, float | str]]:
    return [
        {"stage": "开局", "capacity": 12, "crop_routine": 1, "animal_routine": 1, "operations": 0.5, "focus": 4},
        {"stage": "中期常态", "capacity": 12, "crop_routine": 2, "animal_routine": 2, "operations": 1.5, "focus": 4},
        {"stage": "中期峰值", "capacity": 12, "crop_routine": 2, "animal_routine": 2, "operations": 4, "focus": 4},
        {"stage": "后期常态（升级后）", "capacity": 14, "crop_routine": 3, "animal_routine": 3, "operations": 2, "focus": 3},
    ]


def run_assertions() -> None:
    # Crop balance: standard-quality, ideal-weather adjusted net must stay positive.
    assert all(c.net_per_plot > 0 for c in CROPS)
    cash_base = first_season_cash()
    cash_stress = first_season_cash(yield_factor=0.8, hen_lay_rate=0.70)
    assert cash_base["ending_cash"] > cash_base["start_cash"]
    assert cash_stress["ending_cash"] >= 3500
    assert all(a.expected_daily_net > 0 for a in ANIMALS)
    assert all(30 <= a.payback_days <= 75 for a in ANIMALS)
    assert all(r.uplift > 0 for r in RECIPES)
    for s in workload_scenarios():
        total = s["crop_routine"] + s["animal_routine"] + s["operations"] + s["focus"]
        assert total <= s["capacity"], (s["stage"], total, s["capacity"])


def print_report() -> None:
    run_assertions()
    print("CROPS")
    for c in CROPS:
        print(
            c.name,
            c.harvests,
            round(c.gross_per_plot, 1),
            round(c.seed_cost_per_plot, 1),
            round(c.fertility_reserve_cost, 1),
            round(c.net_per_plot, 1),
            round(c.work_points_per_plot, 1),
            round(c.net_per_plot / c.work_points_per_plot, 1),
        )
    print("ANIMALS")
    for a in ANIMALS:
        print(a.name, round(a.expected_daily_net, 2), round(a.payback_days, 1))
    print("RECIPES")
    for r in RECIPES:
        print(r.name, r.uplift, f"{r.uplift_rate:.1%}")
    print("CASH_BASE", first_season_cash())
    print("CASH_STRESS", first_season_cash(0.8, 0.70))
    print("WORKLOAD")
    for s in workload_scenarios():
        total = s["crop_routine"] + s["animal_routine"] + s["operations"] + s["focus"]
        print(s["stage"], total, "/", s["capacity"], f"{total / s['capacity']:.1%}")


if __name__ == "__main__":
    print_report()
