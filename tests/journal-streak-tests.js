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
  console,
  isFinite,
  isNaN,
};
vm.createContext(context);
vm.runInContext([
  "calcR",
  "getTradeResult",
  "tradeChronologyKey",
  "sortTradesChronologically",
  "calcWinRatePercent",
  "calcStats",
].map(extractFunction).join("\n"), context);

function trade(id, date, time, pnl) {
  return { id, date, entry_time:time, exit_time:time, pnl_dollars:pnl, duration:1 };
}

function testStreakUsesChronologyInsteadOfStorageOrder() {
  const unsorted = [
    trade("l1", "2026-08-01", "09:30", -200),
    trade("w1", "2026-08-04", "09:30", 500),
    trade("l2", "2026-08-02", "09:30", -200),
    trade("l3", "2026-08-03", "09:30", -200),
  ];
  const stats = context.calcStats(unsorted, 500);
  assert.strictEqual(stats.maxConsecL, 3);
  assert.strictEqual(stats.maxConsecW, 1);
}

function testBreakevenAndWinBreakLossStreak() {
  const august26 = [
    trade("be2", "2026-08-26", "13:38", -85),
    trade("l6", "2026-08-26", "13:17", -210),
    trade("l5", "2026-08-26", "12:48", -169),
    trade("be1", "2026-08-26", "12:36", -50),
    trade("l4", "2026-08-26", "12:25", -355),
    trade("l3", "2026-08-26", "11:24", -240),
    trade("w1", "2026-08-26", "10:06", 985),
    trade("l2", "2026-08-26", "09:40", -445),
    trade("l1", "2026-08-26", "09:36", -485),
  ];
  const stats = context.calcStats(august26, 500);
  assert.strictEqual(stats.w, 1);
  assert.strictEqual(stats.l, 6);
  assert.strictEqual(stats.be, 2);
  assert.strictEqual(stats.maxConsecL, 2);
}

testStreakUsesChronologyInsteadOfStorageOrder();
testBreakevenAndWinBreakLossStreak();

console.log("OK - Journal streak tests passed");
