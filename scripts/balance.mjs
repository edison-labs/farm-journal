import { runBalanceChecks } from "../src/rules/balance.js";

const report = runBalanceChecks();
console.log(JSON.stringify({ status: "passed", summary: { crops: report.crops.length, animals: report.animals.length, recipes: report.recipes.length, document_opportunity_model: report.cash_base, document_pressure_model: report.cash_stress, actual_liquid_cash_without_replenishment: report.liquid_cash, runtime_replenishment_strategy: report.runtime_cash, market_expectation: report.market_expectation, workloads: report.workloads } }, null, 2));
