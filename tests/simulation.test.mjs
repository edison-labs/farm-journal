import test from "node:test";
import assert from "node:assert/strict";
import { EXPECTED_ORDER_GENERATION_KEYS, simulateSixStrategies } from "../src/core/simulation.js";

test("TC-059 六类策略以真实语义命令稳定运行84日", () => {
  const result = simulateSixStrategies();
  assert.equal(result.strategies.length, 18);
  assert.equal(result.violations, 0);
  assert.equal(result.free_loop_detected, false);
  assert.equal(result.dominant_strategy, null);
  assert.ok(result.semantic_activity.profit_processing_completions >= 3);
  assert.equal(result.semantic_activity.animal_purchases, 6);
  assert.equal(result.semantic_activity.large_animal_purchases, 3);
  assert.equal(result.semantic_activity.duck_purchases, 3);
  assert.equal(result.semantic_activity.completed_barns, 3);
  assert.deepEqual(result.semantic_activity.animal_species_exercised, ["animal_chicken", "animal_cow", "animal_duck", "animal_goat", "animal_sheep"]);
  assert.equal(result.semantic_activity.generated_order_weeks, 18 * 12);
  assert.ok(result.semantic_activity.accepted_orders >= 1);
  assert.equal(result.semantic_activity.delivered_orders, result.semantic_activity.accepted_orders);
  assert.ok(result.semantic_activity.related_strategy_order_deliveries >= 1);
  assert.ok(result.semantic_activity.delivered_order_source_weeks.length >= 2);
  assert.ok(result.semantic_activity.late_order_deliveries >= 1);

  const normal = new Set(["conservative", "profit", "animal", "story"]);
  for (const strategy of result.strategies) {
    assert.equal(strategy.final_day, 85, strategy.strategy);
    assert.ok(strategy.cash >= 0, strategy.strategy);
    assert.equal(strategy.outstanding_reservations, 0, strategy.strategy);
    assert.equal(strategy.unresolved_storage_anomalies, 0, strategy.strategy);
    assert.equal(strategy.unexpected_errors, 0, strategy.strategy);
    assert.equal(strategy.final_real_date_key, "2026-05-25", strategy.strategy);
    assert.equal(strategy.generated_order_weeks, 12, strategy.strategy);
    assert.deepEqual(strategy.order_generation_keys, EXPECTED_ORDER_GENERATION_KEYS, strategy.strategy);
    assert.ok(strategy.order_created_weeks >= 2, strategy.strategy);
    assert.ok(strategy.late_orders_created >= 1, strategy.strategy);
    assert.ok(strategy.max_active_orders <= 3, strategy.strategy);
    assert.equal(new Set(strategy.order_records.map((order) => order.id)).size, strategy.order_records.length, strategy.strategy);
    for (const order of strategy.order_records) assert.ok(order.deadline_day - order.created_day >= 3 && order.deadline_day - order.created_day <= 7, `${strategy.strategy}:${order.id}`);
    assert.equal(strategy.delivered_orders, strategy.accepted_orders, strategy.strategy);
    assert.equal(strategy.command_counts["work.assign"] ?? 0, 0, strategy.strategy);
    if (normal.has(strategy.strategy)) assert.ok(strategy.average_work_utilization >= 0.5 && strategy.average_work_utilization <= 0.8, strategy.strategy);
    if (strategy.strategy === "profit") assert.ok(strategy.completed_processing >= 1);
    if (strategy.strategy === "animal") {
      assert.equal(strategy.purchased_animals, 2);
      assert.equal(strategy.large_animals, 1);
      assert.equal(strategy.barn_complete, true);
      assert.equal(strategy.purchased_species.animal_duck, 1);
      assert.equal(strategy.purchased_species[strategy.target_large_species], 1);
      assert.ok(strategy.animal_care_days[strategy.target_large_species] >= 7);
      assert.ok(strategy.animal_production[strategy.target_large_species] >= 1);
      const targetProducts = { animal_cow: "item_milk", animal_goat: "item_goat_milk", animal_sheep: "item_wool" };
      assert.ok(strategy.sold_items[targetProducts[strategy.target_large_species]] >= 1);
      const barn = strategy.construction_statuses.find((project) => project.building_id === "build_barn");
      assert.equal(barn.invested_wp, 18);
      assert.equal(barn.activated_day, barn.ready_day + 1);
      assert.ok(strategy.purchased_species_days[strategy.target_large_species][0] >= barn.activated_day);
    }
    if (strategy.strategy === "profit") assert.ok(strategy.delivered_orders >= 1);
    if (strategy.strategy === "story") assert.ok(strategy.event_choices > 0 && strategy.command_counts["resident.talk"] > 0 && strategy.command_counts["exploration.run"] > 0);
    if (strategy.strategy === "low_frequency") {
      assert.ok(strategy.login_days.length >= 12);
      for (let index = 1; index < strategy.login_days.length; index += 1) assert.ok(strategy.login_days[index] - strategy.login_days[index - 1] >= 3 && strategy.login_days[index] - strategy.login_days[index - 1] <= 7);
    }
    if (strategy.strategy === "neglect") assert.equal(strategy.semantic_commands, 0);
  }
});
