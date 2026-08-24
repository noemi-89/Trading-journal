const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractConst(name) {
  const start = html.indexOf("const " + name);
  if (start < 0) throw new Error("Constant not found: " + name);
  const end = html.indexOf(";", start);
  if (end < 0) throw new Error("Constant not closed: " + name);
  return html.slice(start, end + 1);
}

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

const context = { console };
vm.createContext(context);
vm.runInContext([
  "JOURNAL_STORAGE_NAMESPACE",
  "JOURNAL_BACKUP_FORMAT",
  "JOURNAL_BACKUP_VERSION",
].map(extractConst).concat([
  "makeJournalBackupError",
  "isPlainBackupObject",
  "journalStorageKeys",
  "collectJournalStorageItems",
  "createJournalBackup",
  "validateJournalBackup",
  "parseJournalBackupText",
  "replaceJournalStorageItems",
  "restoreJournalBackup",
  "journalBackupFilename",
].map(extractFunction)).join("\n"), context);

class FakeStorage {
  constructor(initial) {
    this.values = new Map();
    Object.keys(initial || {}).forEach((key) => this.values.set(String(key), String(initial[key])));
    this.failSetOnceKey = null;
  }
  get length() { return this.values.size; }
  key(index) { return Array.from(this.values.keys())[index] || null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) {
    key = String(key);
    if (this.failSetOnceKey === key) {
      this.failSetOnceKey = null;
      throw new Error("Simulated quota failure");
    }
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(String(key)); }
  dump() {
    const result = {};
    Array.from(this.values.keys()).sort().forEach((key) => { result[key] = this.values.get(key); });
    return result;
  }
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function backupFrom(items) {
  return plain(context.createJournalBackup(new FakeStorage(items), "2026-08-24T09:04:00.000Z"));
}
function expectErrorCode(fn, expectedCode) {
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  assert(caught, "Expected error " + expectedCode);
  assert.strictEqual(caught.code, expectedCode);
}

function testNamespaceExport() {
  const storage = new FakeStorage({
    "jnl:v2:trades":"[]",
    "jnl:v2:settings":"{\"rv\":250}",
    "jnl:v2:week:2026-W34":"{\"review\":\"ok\"}",
    "jnl:v2:playbook:2026-W34":"{\"lesson\":\"wait\"}",
    "jnl:v2:execution_reviews":"[]",
    "random-other-key":"do-not-export",
  });
  const backup = context.createJournalBackup(storage, "2026-08-24T09:04:00.000Z");
  assert.deepStrictEqual(Object.keys(backup.items).sort(), [
    "jnl:v2:execution_reviews",
    "jnl:v2:playbook:2026-W34",
    "jnl:v2:settings",
    "jnl:v2:trades",
    "jnl:v2:week:2026-W34",
  ]);
  assert.strictEqual(backup.items["random-other-key"], undefined);
}

function testDynamicFutureKey() {
  const backup = backupFrom({"jnl:v2:future_feature_test":"raw-future-value"});
  assert.strictEqual(backup.items["jnl:v2:future_feature_test"], "raw-future-value");
}

function testRoundTripLossless() {
  const original = {
    "jnl:v2:trades":"[ {\"id\":\"t1\",\"notes\":\"  keep spacing  \"} ]",
    "jnl:v2:settings":"{\n  \"rv\": 500\n}",
    "jnl:v2:future_feature_test":"001|raw|value",
  };
  const source = new FakeStorage(original);
  const backup = plain(context.createJournalBackup(source, "2026-08-24T09:04:00.000Z"));
  const target = new FakeStorage({"jnl:v2:stale":"remove-me"});
  context.restoreJournalBackup(target, backup);
  assert.deepStrictEqual(target.dump(), original);
}

function testWeeklyMultipleWeeks() {
  const weeks = {
    "jnl:v2:week:2026-W30":"w30",
    "jnl:v2:week:2026-W31":"w31",
    "jnl:v2:week:2026-W32":"w32",
  };
  const target = new FakeStorage();
  context.restoreJournalBackup(target, backupFrom(weeks));
  assert.deepStrictEqual(target.dump(), weeks);
}

function testPlaybookMultipleWeeks() {
  const playbooks = {
    "jnl:v2:playbook:2026-W30":"p30",
    "jnl:v2:playbook:2026-W31":"p31",
    "jnl:v2:playbook:2026-W32":"p32",
  };
  const target = new FakeStorage();
  context.restoreJournalBackup(target, backupFrom(playbooks));
  assert.deepStrictEqual(target.dump(), playbooks);
}

function testInitialStopPreserved() {
  const trades = JSON.stringify([{id:"trade-1",entry_price:30000,initial_stop_price:29950,initial_stop_source:"manual"}]);
  const target = new FakeStorage();
  context.restoreJournalBackup(target, backupFrom({"jnl:v2:trades":trades}));
  assert.strictEqual(target.getItem("jnl:v2:trades"), trades);
  assert.strictEqual(JSON.parse(target.getItem("jnl:v2:trades"))[0].initial_stop_price, 29950);
}

function testExecutionReviewPreserved() {
  const review = JSON.stringify([{id:"review-1",linkedTradeId:"trade-1",planCompliant:"YES",withoutInterventionExitPrice:29900,decisionNote:"probable invalidation"}]);
  const target = new FakeStorage();
  context.restoreJournalBackup(target, backupFrom({"jnl:v2:execution_reviews":review}));
  assert.strictEqual(target.getItem("jnl:v2:execution_reviews"), review);
}

function testOhlcPreserved() {
  const ohlc = {
    "jnl:v2:ohlc":"[[1787558400,6501.25,6498.5]]",
    "jnl:v2:ohlcmeta":"{\"product\":\"ES\",\"days\":1}",
    "jnl:v2:ohlcNQ":"[[1787558400,24050,23980]]",
    "jnl:v2:ohlcMetaNQ":"{\"product\":\"NQ\",\"days\":1}",
  };
  const target = new FakeStorage();
  context.restoreJournalBackup(target, backupFrom(ohlc));
  assert.deepStrictEqual(target.dump(), ohlc);
}

function testInvalidJsonDoesNotChangeJournal() {
  const storage = new FakeStorage({"jnl:v2:trades":"old"});
  const before = storage.dump();
  expectErrorCode(() => context.parseJournalBackupText("{broken-json"), "INVALID_JSON");
  assert.deepStrictEqual(storage.dump(), before);
}

function testWrongFormatDoesNotChangeJournal() {
  const storage = new FakeStorage({"jnl:v2:trades":"old"});
  const before = storage.dump();
  const backup = backupFrom({"jnl:v2:trades":"new"});
  backup.format = "wrong-format";
  expectErrorCode(() => context.restoreJournalBackup(storage, backup), "INVALID_FORMAT");
  assert.deepStrictEqual(storage.dump(), before);
}

function testUnsupportedVersionDoesNotChangeJournal() {
  const storage = new FakeStorage({"jnl:v2:trades":"old"});
  const before = storage.dump();
  const backup = backupFrom({"jnl:v2:trades":"new"});
  backup.backupVersion = 99;
  expectErrorCode(() => context.restoreJournalBackup(storage, backup), "UNSUPPORTED_VERSION");
  assert.deepStrictEqual(storage.dump(), before);
}

function testForeignKeyInjectionDoesNotChangeJournal() {
  const storage = new FakeStorage({"jnl:v2:trades":"old"});
  const before = storage.dump();
  const backup = backupFrom({"jnl:v2:trades":"new"});
  backup.items["evil-key"] = "attack";
  backup.itemCount++;
  expectErrorCode(() => context.restoreJournalBackup(storage, backup), "FOREIGN_KEY");
  assert.deepStrictEqual(storage.dump(), before);
}

function testReplaceSemantics() {
  const storage = new FakeStorage({
    "jnl:v2:A":"old-A",
    "jnl:v2:B":"old-B",
    "jnl:v2:C":"must-disappear",
  });
  context.restoreJournalBackup(storage, backupFrom({"jnl:v2:A":"new-A","jnl:v2:B":"new-B"}));
  assert.deepStrictEqual(storage.dump(), {"jnl:v2:A":"new-A","jnl:v2:B":"new-B"});
  assert.strictEqual(storage.getItem("jnl:v2:C"), null);
}

function testUnrelatedStoragePreserved() {
  const storage = new FakeStorage({"jnl:v2:trades":"old","unrelated-key":"hello"});
  context.restoreJournalBackup(storage, backupFrom({"jnl:v2:trades":"new"}));
  assert.strictEqual(storage.getItem("jnl:v2:trades"), "new");
  assert.strictEqual(storage.getItem("unrelated-key"), "hello");
}

function testWriteFailureRollback() {
  const current = {
    "jnl:v2:trades":"old-trades",
    "jnl:v2:week:2026-W33":"old-week",
    "unrelated-key":"hello",
  };
  const storage = new FakeStorage(current);
  const backup = backupFrom({"jnl:v2:settings":"new-settings","jnl:v2:trades":"new-trades"});
  storage.failSetOnceKey = "jnl:v2:settings";
  expectErrorCode(() => context.restoreJournalBackup(storage, backup), "RESTORE_FAILED");
  assert.deepStrictEqual(storage.dump(), current);
}

function testItemCount() {
  const backup = backupFrom({"jnl:v2:A":"a","jnl:v2:B":"b","jnl:v2:C":"c"});
  assert.strictEqual(backup.itemCount, 3);
  backup.itemCount = 2;
  expectErrorCode(() => context.validateJournalBackup(backup), "INVALID_ITEM_COUNT");
}

function testEmptyBackupPrevention() {
  expectErrorCode(() => context.createJournalBackup(new FakeStorage({"random-key":"x"}), "2026-08-24T09:04:00.000Z"), "EMPTY_JOURNAL");
  const empty = {
    format:"hello-noemi-trading-journal-backup",
    backupVersion:1,
    namespace:"jnl:v2:",
    exportedAt:"2026-08-24T09:04:00.000Z",
    itemCount:0,
    items:{},
  };
  expectErrorCode(() => context.validateJournalBackup(empty), "EMPTY_BACKUP");
}

testNamespaceExport();
testDynamicFutureKey();
testRoundTripLossless();
testWeeklyMultipleWeeks();
testPlaybookMultipleWeeks();
testInitialStopPreserved();
testExecutionReviewPreserved();
testOhlcPreserved();
testInvalidJsonDoesNotChangeJournal();
testWrongFormatDoesNotChangeJournal();
testUnsupportedVersionDoesNotChangeJournal();
testForeignKeyInjectionDoesNotChangeJournal();
testReplaceSemantics();
testUnrelatedStoragePreserved();
testWriteFailureRollback();
testItemCount();
testEmptyBackupPrevention();

console.log("OK - 17 backup/restore Journal tests passed");
