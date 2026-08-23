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

const context = { console, isFinite, isNaN };
vm.createContext(context);
vm.runInContext([
  "parseOptionalPrice",
  "initialStopInfoForTrade",
  "initialRiskPointsForTrade",
  "executionRForExitPrice",
  "executionTradeShouldNotExist",
  "deriveExecutionReview",
  "calcExecutionReviewSummary",
].map(extractFunction).join("\n"), context);

function approx(actual, expected, label) {
  assert(actual != null, label + " should be available");
  assert(Math.abs(actual - expected) < 0.000001, label + ": " + actual + " != " + expected);
}
function makeTrade(id, date, direction, entry, stop, exit) {
  return {
    id:id,
    date:date,
    entry_time:"10:00",
    exit_time:"10:15",
    product:"NQ",
    direction:direction,
    entry_price:entry,
    exit_price:exit,
    initial_stop_price:stop,
  };
}
function makeReview(id, tradeId, overrides) {
  return Object.assign({
    id:id,
    linkedTradeId:tradeId,
    planCompliant:"NO",
    tradeShouldNotExist:false,
    planCompliantExitPrice:null,
  }, overrides || {});
}

function testLongEarlyExit() {
  const trade = makeTrade("long", "2026-08-17", "Buy", 100, 90, 110);
  const result = context.deriveExecutionReview(makeReview("r1", trade.id, {planCompliantExitPrice:120}), trade);
  approx(result.actualR, 1, "long actual R");
  approx(result.planCompliantR, 2, "long plan R");
  approx(result.executionImpact, -1, "long impact");
}
function testShortEarlyExit() {
  const trade = makeTrade("short", "2026-08-17", "Sell", 100, 110, 90);
  const result = context.deriveExecutionReview(makeReview("r2", trade.id, {planCompliantExitPrice:80}), trade);
  approx(result.actualR, 1, "short actual R");
  approx(result.planCompliantR, 2, "short plan R");
  approx(result.executionImpact, -1, "short impact");
}
function testWrongTradeLoser() {
  const trade = makeTrade("wrong-loss", "2026-08-18", "Buy", 100, 90, 90);
  const result = context.deriveExecutionReview(makeReview("r3", trade.id, {tradeShouldNotExist:true}), trade);
  approx(result.actualR, -1, "wrong loser actual R");
  approx(result.planCompliantR, 0, "wrong loser plan R");
  approx(result.executionImpact, -1, "wrong loser impact");
}
function testWrongTradeWinner() {
  const trade = makeTrade("wrong-win", "2026-08-18", "Buy", 100, 90, 115);
  const review = makeReview("r4", trade.id, {tradeShouldNotExist:true});
  const result = context.deriveExecutionReview(review, trade);
  approx(result.actualR, 1.5, "wrong winner actual R");
  approx(result.planCompliantR, 0, "wrong winner plan R");
  approx(result.executionImpact, 1.5, "wrong winner impact");
  assert.strictEqual(review.planCompliant, "NO");
}
function testDeviationSavedR() {
  const trade = makeTrade("saved", "2026-08-19", "Buy", 100, 90, 105);
  const result = context.deriveExecutionReview(makeReview("r5", trade.id, {planCompliantExitPrice:90}), trade);
  approx(result.actualR, 0.5, "saved actual R");
  approx(result.planCompliantR, -1, "saved plan R");
  approx(result.executionImpact, 1.5, "saved impact");
}
function testMissingInitialStop() {
  const trade = makeTrade("missing", "2026-08-19", "Buy", 100, null, 110);
  delete trade.initial_stop_price;
  const result = context.deriveExecutionReview(makeReview("r6", trade.id, {planCompliantExitPrice:120}), trade);
  assert.strictEqual(result.actualR, null);
  assert.strictEqual(result.planCompliantR, null);
  assert.strictEqual(result.executionImpact, null);
}
function testOnlySelectedTradeIsReviewed() {
  const trades = [0,1,2,3].map(function(i){ return makeTrade("same-"+i, "2026-08-20", "Buy", 100, 90, 110+i); });
  const before = JSON.stringify(trades);
  const summary = context.calcExecutionReviewSummary([makeReview("only-one", "same-3", {planCompliantExitPrice:120})], trades);
  assert.strictEqual(summary.reviewedTrades, 1);
  assert.strictEqual(summary.rows[0].trade.id, "same-3");
  assert.strictEqual(JSON.stringify(trades), before, "trade records must not be classified or changed");
}
function testDeviationDaysSameDate() {
  const trades = [0,1,2].map(function(i){ return makeTrade("day-"+i, "2026-08-21", "Buy", 100, 90, 110); });
  const reviews = trades.map(function(trade,i){ return makeReview("day-r-"+i, trade.id, {planCompliantExitPrice:120}); });
  assert.strictEqual(context.calcExecutionReviewSummary(reviews, trades).deviationDays, 1);
}
function testDeviationDaysDifferentDates() {
  const dates = ["2026-08-17","2026-08-18","2026-08-19"];
  const trades = dates.map(function(date,i){ return makeTrade("date-"+i, date, "Buy", 100, 90, 110); });
  const reviews = trades.map(function(trade,i){ return makeReview("date-r-"+i, trade.id, {planCompliantExitPrice:120}); });
  assert.strictEqual(context.calcExecutionReviewSummary(reviews, trades).deviationDays, 3);
}
function testPlanCompliantExcludedFromDeviationTotals() {
  const trade = makeTrade("compliant", "2026-08-22", "Buy", 100, 90, 110);
  const review = makeReview("r10", trade.id, {planCompliant:"YES", planCompliantExitPrice:null});
  const derived = context.deriveExecutionReview(review, trade);
  approx(derived.actualR, 1, "compliant actual R");
  approx(derived.planCompliantR, 1, "compliant plan R");
  approx(derived.executionImpact, 0, "compliant impact");
  const summary = context.calcExecutionReviewSummary([review], [trade]);
  assert.strictEqual(summary.reviewedTrades, 1);
  assert.strictEqual(summary.harmfulDeviations, 0);
  assert.strictEqual(summary.beneficialDeviations, 0);
  approx(summary.totalRLost, 0, "compliant lost total");
  approx(summary.totalRGained, 0, "compliant gained total");
  approx(summary.netExecutionImpact, 0, "compliant net total");
  assert.strictEqual(summary.measuredCompliantDecisions, 0);
  assert.strictEqual(summary.measuredDecisions, 0);
}
function testInitialStopEditRecalculates() {
  const trade = makeTrade("stop-edit", "2026-08-22", "Buy", 100, 90, 110);
  const review = makeReview("r11", trade.id, {planCompliantExitPrice:120});
  const before = context.deriveExecutionReview(review, trade);
  trade.initial_stop_price = 95;
  const after = context.deriveExecutionReview(review, trade);
  approx(before.actualR, 1, "before stop edit actual R");
  approx(after.actualR, 2, "after stop edit actual R");
  approx(after.planCompliantR, 4, "after stop edit plan R");
  approx(after.executionImpact, -2, "after stop edit impact");
}
function testNoMfeDependency() {
  const trade = makeTrade("no-mfe", "2026-08-23", "Buy", 100, 90, 110);
  const review = makeReview("r12", trade.id, {planCompliantExitPrice:120});
  trade.mae_mfe = {mfe_r:2, mae_r:0.2, mfe_points:20};
  const before = context.deriveExecutionReview(review, trade);
  trade.mae_mfe = {mfe_r:999, mae_r:999, mfe_points:9999};
  const after = context.deriveExecutionReview(review, trade);
  assert.deepStrictEqual(after, before);
}
function testHelpfulCompliantDecisionLong() {
  const trade = makeTrade("helpful-long", "2026-08-23", "Buy", 100, 90, 105);
  const review = makeReview("r13", trade.id, {planCompliant:"YES", planCompliantExitPrice:null, withoutInterventionExitPrice:80});
  const result = context.deriveExecutionReview(review, trade);
  approx(result.actualR, 0.5, "helpful long actual R");
  approx(result.withoutInterventionR, -2, "helpful long without intervention R");
  approx(result.compliantDecisionValue, 2.5, "helpful long decision value");
  approx(result.executionImpact, 0, "helpful long deviation impact");
}
function testHelpfulCompliantDecisionShort() {
  const trade = makeTrade("helpful-short", "2026-08-23", "Sell", 100, 110, 95);
  const review = makeReview("r14", trade.id, {planCompliant:"YES", planCompliantExitPrice:null, withoutInterventionExitPrice:120});
  const result = context.deriveExecutionReview(review, trade);
  approx(result.actualR, 0.5, "helpful short actual R");
  approx(result.withoutInterventionR, -2, "helpful short without intervention R");
  approx(result.compliantDecisionValue, 2.5, "helpful short decision value");
}
function testCompliantDecisionSummary() {
  const helpfulTrade = makeTrade("summary-help", "2026-08-23", "Buy", 100, 90, 105);
  const harmfulTrade = makeTrade("summary-harm", "2026-08-24", "Buy", 100, 90, 105);
  const reviews = [
    makeReview("r15", helpfulTrade.id, {planCompliant:"YES", withoutInterventionExitPrice:80}),
    makeReview("r16", harmfulTrade.id, {planCompliant:"YES", withoutInterventionExitPrice:115}),
  ];
  const summary = context.calcExecutionReviewSummary(reviews, [helpfulTrade,harmfulTrade]);
  assert.strictEqual(summary.measuredCompliantDecisions, 2);
  assert.strictEqual(summary.helpfulCompliantDecisions, 1);
  assert.strictEqual(summary.harmfulCompliantDecisions, 1);
  approx(summary.compliantRAdded, 2.5, "compliant R added");
  approx(summary.compliantRLost, 1, "compliant R lost");
  approx(summary.netCompliantDecisionValue, 1.5, "net compliant decision value");
  assert.strictEqual(summary.harmfulDeviations, 0);
  assert.strictEqual(summary.beneficialDeviations, 0);
}
function testUnifiedDecisionSummary() {
  const earlyExitTrade = makeTrade("unified-early", "2026-08-19", "Buy", 100, 99, 101.55);
  const intuitiveTrade = makeTrade("unified-intuition", "2026-08-17", "Buy", 100, 99, 99.76);
  const reviews = [
    makeReview("r-unified-early", earlyExitTrade.id, {planCompliant:"NO", planCompliantExitPrice:102.27}),
    makeReview("r-unified-intuition", intuitiveTrade.id, {planCompliant:"YES", withoutInterventionExitPrice:99}),
  ];
  const summary = context.calcExecutionReviewSummary(reviews, [earlyExitTrade,intuitiveTrade]);
  assert.strictEqual(summary.reviewedTrades, 2);
  assert.strictEqual(summary.measuredDecisions, 2);
  assert.strictEqual(summary.helpfulDecisions, 1);
  assert.strictEqual(summary.harmfulDecisions, 1);
  approx(summary.totalDecisionRGained, 0.76, "unified R gained");
  approx(summary.totalDecisionRLost, 0.72, "unified R lost");
  approx(summary.netDecisionImpact, 0.04, "unified net decision impact");
}
function testCompliantDecisionMissingStop() {
  const trade = makeTrade("compliant-missing-stop", "2026-08-23", "Buy", 100, null, 105);
  delete trade.initial_stop_price;
  const review = makeReview("r17", trade.id, {planCompliant:"YES", withoutInterventionExitPrice:80});
  const result = context.deriveExecutionReview(review, trade);
  assert.strictEqual(result.actualR, null);
  assert.strictEqual(result.withoutInterventionR, null);
  assert.strictEqual(result.compliantDecisionValue, null);
}
function testCompliantDecisionReactsToInitialStopEdit() {
  const trade = makeTrade("compliant-stop-edit", "2026-08-23", "Buy", 100, 90, 105);
  const review = makeReview("r18", trade.id, {planCompliant:"YES", withoutInterventionExitPrice:80});
  const before = context.deriveExecutionReview(review, trade);
  trade.initial_stop_price = 95;
  const after = context.deriveExecutionReview(review, trade);
  approx(before.compliantDecisionValue, 2.5, "compliant value before stop edit");
  approx(after.compliantDecisionValue, 5, "compliant value after stop edit");
}
function testOvertradingNeverShouldExist() {
  const trade = makeTrade("overtrading", "2026-08-23", "Buy", 100, 90, 115);
  const review = makeReview("r19", trade.id, {deviationType:"Overtrading", tradeShouldNotExist:false, planCompliantExitPrice:120});
  const result = context.deriveExecutionReview(review, trade);
  assert.strictEqual(context.executionTradeShouldNotExist(review), true);
  approx(result.planCompliantR, 0, "overtrading plan R");
  approx(result.executionImpact, 1.5, "overtrading winner impact");
}

testLongEarlyExit();
testShortEarlyExit();
testWrongTradeLoser();
testWrongTradeWinner();
testDeviationSavedR();
testMissingInitialStop();
testOnlySelectedTradeIsReviewed();
testDeviationDaysSameDate();
testDeviationDaysDifferentDates();
testPlanCompliantExcludedFromDeviationTotals();
testInitialStopEditRecalculates();
testNoMfeDependency();
testHelpfulCompliantDecisionLong();
testHelpfulCompliantDecisionShort();
testCompliantDecisionSummary();
testUnifiedDecisionSummary();
testCompliantDecisionMissingStop();
testCompliantDecisionReactsToInitialStopEdit();
testOvertradingNeverShouldExist();

console.log("OK - Execution Review tests passed");
