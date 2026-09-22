const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractFunction(name) {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Function not found: " + name);
  const paramOpen = html.indexOf("(", start);
  let paramDepth = 0;
  let paramEnd = -1;
  for (let i = paramOpen; i < html.length; i++) {
    if (html[i] === "(") paramDepth++;
    if (html[i] === ")") {
      paramDepth--;
      if (paramDepth === 0) { paramEnd = i; break; }
    }
  }
  const open = html.indexOf("{", paramEnd);
  let depth = 0;
  let state = "code";
  let quote = "";
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    const next = html[i + 1];
    if (state === "line") { if (ch === "\n") state = "code"; continue; }
    if (state === "block") { if (ch === "*" && next === "/") { state = "code"; i++; } continue; }
    if (state === "string") {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) state = "code";
      continue;
    }
    if (ch === "/" && next === "/") { state = "line"; i++; continue; }
    if (ch === "/" && next === "*") { state = "block"; i++; continue; }
    if (ch === "\"" || ch === "'" || ch === "`") { state = "string"; quote = ch; continue; }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error("Function not closed: " + name);
}

const context = {
  BE_THRESHOLD_DOLLARS: 150,
  MONTE_CARLO_DEFAULT_SEED: 314159265,
  console,
  isFinite,
  isNaN,
};
vm.createContext(context);
vm.runInContext([
  "validRValue",
  "validPropLimitValue",
  "calcR",
  "getTradeResult",
  "tradeChronologyKey",
  "sortTradesChronologically",
  "percentile",
  "calcRiskSeries",
  "buildMonteCarloSample",
  "seededRandom",
  "runMonteCarlo",
  "buildHistogram",
].map(extractFunction).join("\n"), context);

function near(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function trade(id, date, pnl, extra = {}) {
  return {
    id,
    date,
    entry_time: extra.entry_time || "09:30",
    exit_time: extra.exit_time || "09:35",
    pnl_dollars: pnl,
    result: extra.result || (pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "BE"),
    partial: !!extra.partial,
  };
}

function testDrawdownUsesChronologyAndRunningPeak() {
  const trades = [
    trade("third", "2026-01-03", 250),
    trade("first", "2026-01-01", 500),
    trade("second", "2026-01-02", -1000),
  ];
  const risk = context.calcRiskSeries(trades, 500);
  assert.deepStrictEqual(Array.from(risk.points, point => point.equity), [0, 1, -1, -0.5]);
  assert.deepStrictEqual(Array.from(risk.points, point => point.drawdown), [0, 0, 2, 1.5]);
  near(risk.maxDrawdown, 2);
  near(risk.currentDrawdown, 1.5);
  assert.strictEqual(risk.maxDrawdownDate, "2026-01-02");
  assert.strictEqual(risk.longestUnderwaterTrades, 2);
}

function testDailyBlocksKeepPartialsAndBreakevenEconomicsTogether() {
  const trades = [
    trade("a", "2026-01-01", 100, {partial:true}),
    trade("b", "2026-01-01", -50),
    trade("c", "2026-01-02", 500),
    trade("c", "2026-01-02", 500),
    trade("open", "2026-01-03", 0, {result:"Open"}),
  ];
  const sample = context.buildMonteCarloSample(trades, 500);
  assert.strictEqual(sample.dayCount, 2);
  assert.strictEqual(sample.tradeCount, 3);
  assert.strictEqual(sample.duplicateIds, 1);
  assert.strictEqual(sample.partialRows, 1);
  assert.strictEqual(sample.beTrades, 2);
  near(sample.blocks[0].r, 0.1);
  near(sample.blocks[1].r, 1);
  assert.deepStrictEqual(Array.from(sample.blocks[0].returns), [0.2, -0.1]);
}

function testKnownMonteCarloPath() {
  const result = context.runMonteCarlo([{date:"2026-01-01",r:-1}], 3, 100, 7, 2);
  near(result.finalMedian, -3);
  near(result.finalP05, -3);
  near(result.maxDrawdownMedian, 3);
  near(result.maxDrawdownP95, 3);
  near(result.positiveProbability, 0);
  near(result.propBreachProbability, 1);
  near(result.maxLossStreakMedian, 3);
  near(result.maxUnderwaterMedian, 3);
}

function testSimulationIsRepeatableForTheSameSeed() {
  const blocks = [{r:-1},{r:0.25},{r:1.5}];
  const first = context.runMonteCarlo(blocks, 20, 300, 12345, 4);
  const second = context.runMonteCarlo(blocks, 20, 300, 12345, 4);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(first)),
    JSON.parse(JSON.stringify(second))
  );
}

function testIntradayDrawdownSurvivesDailyBlockBootstrap() {
  const result = context.runMonteCarlo([{r:0,returns:[-5,5]}], 1, 20, 91, 4);
  near(result.finalMedian, 0);
  near(result.maxDrawdownMedian, 5);
  near(result.propBreachProbability, 1);
}

function testHistogramAccountsForEverySimulation() {
  const values = [0, 0.2, 0.5, 1, 2, 3, 4];
  const bins = context.buildHistogram(values, 5);
  assert.strictEqual(bins.reduce((sum, bin) => sum + bin.count, 0), values.length);
  near(bins.reduce((sum, bin) => sum + bin.pct, 0), 1);
}

testDrawdownUsesChronologyAndRunningPeak();
testDailyBlocksKeepPartialsAndBreakevenEconomicsTogether();
testKnownMonteCarloPath();
testSimulationIsRepeatableForTheSameSeed();
testIntradayDrawdownSurvivesDailyBlockBootstrap();
testHistogramAccountsForEverySimulation();

assert.ok(html.includes('{k:"montecarlo",l:"MONTE CARLO"}'));
assert.ok(html.includes("La simulazione descrive la variabilita del campione registrato"));

console.log("OK - Journal drawdown and Monte Carlo tests passed");

module.exports = {
  calcRiskSeries: context.calcRiskSeries,
  buildMonteCarloSample: context.buildMonteCarloSample,
  runMonteCarlo: context.runMonteCarlo,
};
