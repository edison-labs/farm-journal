import { WEATHER, WEATHER_WEIGHTS, byId } from "../content/definitions.js";
import { deterministicRoll, weightedChoice } from "../core/rng.js";
import { calendarFromAbsolute } from "../core/utils.js";

export function weatherDefinition(id) {
  return byId(WEATHER, id);
}

export function generateWeather(saveSeed, absoluteDay, priorWeather = []) {
  const calendar = calendarFromAbsolute(absoluteDay);
  const weights = WEATHER_WEIGHTS[calendar.season];
  const weekBlock = calendar.week_block;
  const currentBlockHistory = priorWeather.filter((entry) => entry.week_block === weekBlock);
  const stormUsed = currentBlockHistory.some((entry) => entry.weather_id === "weather_storm");
  const lastTwo = priorWeather.slice(-2).map((entry) => entry.weather_id);
  const candidates = Object.entries(weights)
    .filter(([id]) => !(id === "weather_storm" && stormUsed))
    .filter(([id]) => !(lastTwo.length === 2 && lastTwo.every((previous) => previous === id) && weatherDefinition(id).tags.includes("severe")))
    .map(([value, weight]) => ({
      value,
      weight: value === "weather_storm" ? weight * (calendar.season === "summer" ? 1.5 : 1.15) : weight,
    }));
  const roll = deterministicRoll(saveSeed, "weather", absoluteDay, `weather_block_${weekBlock}`, absoluteDay % 7).value;
  return weightedChoice(candidates, roll);
}

export function makeForecast(saveSeed, absoluteDay, actualWeather, distance) {
  if (distance <= 1) return actualWeather;
  const accuracy = distance === 2 ? 0.8 : distance === 3 ? 0.65 : 0.5;
  const accurate = deterministicRoll(saveSeed, "forecast_accuracy", absoluteDay, actualWeather, distance).value < accuracy;
  if (accurate) return actualWeather;
  const definition = weatherDefinition(actualWeather);
  const neighbors = definition.forecast_neighbors.filter((id) => id !== actualWeather && WEATHER.some((weather) => weather.id === id));
  if (!neighbors.length) return actualWeather;
  const roll = deterministicRoll(saveSeed, "forecast_neighbor", absoluteDay, actualWeather, distance).value;
  return neighbors[Math.min(neighbors.length - 1, Math.floor(roll * neighbors.length))];
}

export function generateForecast(saveSeed, fromAbsoluteDay, priorWeather, days = 3) {
  const simulated = priorWeather.map((entry) => ({ ...entry }));
  const forecast = [];
  for (let distance = 1; distance <= days; distance += 1) {
    const absoluteDay = fromAbsoluteDay + distance;
    const actual = generateWeather(saveSeed, absoluteDay, simulated);
    forecast.push({ distance, weather_id: makeForecast(saveSeed, absoluteDay, actual, distance), actual_weather_id: actual });
    simulated.push({ day: absoluteDay, weather_id: actual, week_block: calendarFromAbsolute(absoluteDay).week_block });
  }
  return forecast;
}

export function simulateWeatherSeasons(seedPrefix, seasons = 10000) {
  const counts = Object.fromEntries(WEATHER.map((weather) => [weather.id, 0]));
  const seasonCounts = { spring: {}, summer: {}, autumn: {}, winter: {} };
  let constraintViolations = 0;
  for (let simulation = 0; simulation < seasons; simulation += 1) {
    const history = [];
    const offset = (simulation % 4) * 21;
    for (let day = 1; day <= 21; day += 1) {
      const absoluteDay = offset + day;
      const calendar = calendarFromAbsolute(absoluteDay);
      const weatherId = generateWeather(`${seedPrefix}:${simulation}`, absoluteDay, history);
      const entry = { weather_id: weatherId, week_block: calendar.week_block };
      history.push(entry);
      counts[weatherId] += 1;
      seasonCounts[calendar.season][weatherId] = (seasonCounts[calendar.season][weatherId] ?? 0) + 1;
      const block = history.filter((record) => record.week_block === entry.week_block);
      if (block.filter((record) => record.weather_id === "weather_storm").length > 1) constraintViolations += 1;
      const lastThree = history.slice(-3).map((record) => record.weather_id);
      if (lastThree.length === 3 && lastThree.every((id) => id === weatherId) && weatherDefinition(weatherId).tags.includes("severe")) constraintViolations += 1;
    }
  }
  return { seasons, counts, season_counts: seasonCounts, constraint_violations: constraintViolations };
}
