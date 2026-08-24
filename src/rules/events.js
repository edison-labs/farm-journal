import { EVENTS, byId } from "../content/definitions.js";
import { auditedRoll, deterministicRoll, weightedChoice } from "../core/rng.js";
import { applyEffects, evaluateCondition, previewEffects } from "./dsl.js";

function eventEligible(state, event) {
  if (!evaluateCondition(state, event.conditions)) return false;
  if ((state.events.cooldowns[event.id] ?? 0) > state.calendar.absolute_day) return false;
  if (state.events.active.some((active) => active.event_id === event.id)) return false;
  if (event.exclusive_group && state.events.active.some((active) => active.exclusive_group === event.exclusive_group)) return false;
  return true;
}

function eventWeight(state, event) {
  const recent = state.events.recent_tags.some((entry) => entry.day >= state.calendar.absolute_day - 7 && event.tags.some((tag) => entry.tags.includes(tag)));
  const seasonMultiplier = event.tags.includes(state.calendar.season) || event.tags.includes(`season_${["spring", "summer", "autumn", "winter"].indexOf(state.calendar.season)}`) ? 1.25 : 1;
  const weatherMultiplier = (state.weather?.today_tags ?? []).some((tag) => event.tags.includes(tag)) ? 1.2 : 1;
  const urgentState = event.tags.includes("animal") && state.animals.some((animal) => animal.health < 60 || animal.illness) ? 1.5 : event.tags.includes("plot") && state.plots.some((plot) => plot.crop && plot.crop.health < 40) ? 1.5 : 1;
  return event.base_weight * seasonMultiplier * weatherMultiplier * urgentState * (recent ? 0.25 : 1);
}

function chooseWeightedEvent(state, candidates, slot) {
  const entries = candidates.map((event) => ({ value: event.id, weight: eventWeight(state, event) }));
  const roll = deterministicRoll(state.save_seed, "event_director", state.calendar.absolute_day, `slot_${slot}`, 0).value;
  return byId(EVENTS, weightedChoice(entries, roll));
}

export function generateDailyEvents(state) {
  if (state.events.week_block !== state.calendar.week_block) {
    state.events.week_block = state.calendar.week_block;
    state.events.weekly_urgent_count = 0;
  }
  let budget = 6;
  const selected = [];
  let candidates = EVENTS.filter((event) => eventEligible(state, event));
  if (state.events.weekly_urgent_count < 2) {
    const urgent = candidates.filter((event) => event.urgent && event.attention_cost <= budget);
    if (urgent.length) {
      const event = chooseWeightedEvent(state, urgent, "urgent");
      selected.push(event);
      budget -= event.attention_cost;
      state.events.weekly_urgent_count += 1;
      candidates = candidates.filter((candidate) => candidate.id !== event.id && (!event.exclusive_group || candidate.exclusive_group !== event.exclusive_group));
    }
  }
  const storyCandidates = candidates.filter((event) => !event.urgent && ["main", "resident"].includes(event.category) && event.attention_cost <= budget);
  if (selected.length < 3 && storyCandidates.length) {
    const event = chooseWeightedEvent(state, storyCandidates, "story");
    selected.push(event); budget -= event.attention_cost;
    candidates = candidates.filter((candidate) => candidate.id !== event.id && (!event.exclusive_group || candidate.exclusive_group !== event.exclusive_group));
  }
  for (let slot = selected.length; slot < 3 && budget > 0; slot += 1) {
    const fitting = candidates.filter((event) => !event.urgent && !["main", "resident"].includes(event.category) && event.attention_cost <= budget);
    if (!fitting.length) break;
    const event = chooseWeightedEvent(state, fitting, slot);
    selected.push(event);
    budget -= event.attention_cost;
    candidates = candidates.filter((candidate) => candidate.id !== event.id && (!event.exclusive_group || candidate.exclusive_group !== event.exclusive_group));
  }
  for (const event of selected) {
    state.events.active.push({
      event_id: event.id,
      created_day: state.calendar.absolute_day,
      deadline_day: event.deadline_days ? state.calendar.absolute_day + event.deadline_days - 1 : null,
      urgent: event.urgent,
      attention_cost: event.attention_cost,
      exclusive_group: event.exclusive_group,
      status: "pending",
    });
    state.events.cooldowns[event.id] = state.calendar.absolute_day + event.cooldown_days;
    state.events.recent_tags.push({ day: state.calendar.absolute_day, tags: event.tags });
  }
  if (!selected.length) state.daily_ledgers.push({ type: "life_log", layer: "life", day: state.calendar.absolute_day, message: "今天没有需要选择的事件；牧场按既有节奏继续。" });
  state.events.recent_tags = state.events.recent_tags.filter((entry) => entry.day >= state.calendar.absolute_day - 7);
  return selected.map((event) => event.id);
}

export function previewEventChoice(state, eventId, choiceId) {
  const active = state.events.active.find((entry) => entry.event_id === eventId && entry.status === "pending");
  if (!active) throw new Error("事件不在待处理列表");
  const event = byId(EVENTS, eventId);
  const choice = event.choices.find((entry) => entry.id === choiceId);
  if (!choice) throw new Error("事件选项不存在");
  if (!evaluateCondition(state, choice.conditions)) throw new Error("事件选项条件未满足");
  return previewEffects(state, choice.effects, { source: "event", event_id: eventId, choice_id: choiceId });
}

export function chooseEvent(state, eventId, choiceId) {
  const active = state.events.active.find((entry) => entry.event_id === eventId && entry.status === "pending");
  if (!active) throw new Error("事件不在待处理列表");
  const event = byId(EVENTS, eventId);
  const choice = event.choices.find((entry) => entry.id === choiceId);
  if (!choice || !evaluateCondition(state, choice.conditions)) throw new Error("事件选项不存在或条件未满足");
  applyEffects(state, choice.effects, { source: "event", event_id: eventId, choice_id: choiceId });
  active.status = "resolved";
  active.choice_id = choiceId;
  active.resolved_day = state.calendar.absolute_day;
  const subjectIds = event.tags.filter((tag) => tag.startsWith("resident_") || tag.startsWith("animal_") || tag.startsWith("plot_"));
  const history = { event_id: eventId, choice_id: choiceId, day: state.calendar.absolute_day, subject_ids: subjectIds, theme_tags: [...event.tags], summary: event.summary_template };
  state.events.history.push(history);
  state.daily_ledgers.push({ type: "decision", layer: "decision", day: state.calendar.absolute_day, event_id: eventId, choice_id: choiceId, subject_ids: subjectIds, theme_tags: [...event.tags], message: `${event.title}：${choice.label}` });
  for (const residentId of subjectIds.filter((id) => state.residents[id])) {
    const experiences = state.residents[residentId].shared_experiences;
    experiences.push({ event_id: eventId, choice_id: choiceId, day: state.calendar.absolute_day, theme_tags: [...event.tags] });
    if (experiences.length > 50) experiences.splice(0, experiences.length - 50);
  }
  state.events.active = state.events.active.filter((entry) => entry.status === "pending");
  return { event_id: eventId, choice_id: choiceId };
}

export function processScheduledEffects(state) {
  const due = state.events.scheduled_effects.filter((entry) => entry.due_day <= state.calendar.absolute_day);
  for (const scheduled of due) {
    let effects = scheduled.effects;
    if (scheduled.random) {
      const roll = auditedRoll(state, "scheduled_effect", `${scheduled.source_event}:${scheduled.source_choice}`, scheduled.due_day);
      effects = roll < scheduled.random.success_probability ? scheduled.random.success : scheduled.random.failure;
    }
    applyEffects(state, effects, { source: "scheduled_event", event_id: scheduled.source_event, choice_id: scheduled.source_choice });
    state.daily_ledgers.push({ type: "scheduled_effect", source_event: scheduled.source_event, source_choice: scheduled.source_choice, day: state.calendar.absolute_day });
  }
  state.events.scheduled_effects = state.events.scheduled_effects.filter((entry) => entry.due_day > state.calendar.absolute_day);
  return due.length;
}

export function expireEvents(state) {
  const expired = state.events.active.filter((entry) => entry.deadline_day !== null && entry.deadline_day < state.calendar.absolute_day);
  for (const active of expired) state.events.history.push({ event_id: active.event_id, choice_id: null, day: state.calendar.absolute_day, outcome: "expired_without_permanent_loss" });
  state.events.active = state.events.active.filter((entry) => !expired.includes(entry));
  return expired.map((entry) => entry.event_id);
}
