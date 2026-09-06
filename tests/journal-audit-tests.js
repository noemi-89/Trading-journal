// Run with JOURNAL_BABEL_PATH pointing to Babel standalone 7.23.2 (the app version).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const babel = require(process.env.JOURNAL_BABEL_PATH || "@babel/standalone");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const source = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)[1];
const compiled = babel.transform(source, {presets:["react"]}).code;
new vm.Script(compiled);

class FakeStorage {
  constructor(values = {}) { this.values = {...values}; this.writes = 0; this.failAt = 0; this.readError = false; }
  getItem(key) { if (this.readError) throw new Error("Read blocked"); return this.values[key] ?? null; }
  setItem(key, value) {
    if (++this.writes === this.failAt) throw new Error("QuotaExceededError");
    this.values[key] = String(value);
  }
  removeItem(key) { delete this.values[key]; }
}

// Render the actual JSX handlers and effects without touching browser storage.
function environment(values) {
  const target = new FakeStorage(values);
  let owner;
  const React = {
    createElement(type, props, ...children) { return {type, props:{...props, children:children.flat(Infinity)}}; },
    useState(initial) {
      const component = owner, i = owner.cursor++;
      if (!(i in component.slots)) component.slots[i] = typeof initial === "function" ? initial() : initial;
      return [component.slots[i], value => {
        component.slots[i] = typeof value === "function" ? value(component.slots[i]) : value;
        component.pending = true;
      }];
    },
    useRef(initial) {
      const i = owner.cursor++;
      if (!(i in owner.slots)) owner.slots[i] = {current:initial};
      return owner.slots[i];
    },
    useEffect(fn, deps) {
      const component = owner, i = owner.cursor++, old = owner.slots[i];
      if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) {
        component.effects.push(() => {
          if (old && old.cleanup) old.cleanup();
          component.slots[i] = {deps, cleanup:fn()};
        });
      }
    },
  };
  const context = vm.createContext({
    React, ReactDOM:{createRoot:() => ({render(){}})}, localStorage:target, console,
    document:{getElementById:() => ({})}, window:{confirm:() => true},
    setTimeout:() => 1, clearTimeout(){}, setInterval:() => 1, clearInterval(){},
    FileReader:class { readAsText(file) { this.onload({target:{result:file.text}}); } },
  });
  vm.runInContext(compiled, context);
  function mount(name, props = {}) {
    const component = {slots:[], effects:[], cursor:0, pending:false, props};
    component.render = () => {
      owner = component; component.cursor = 0; component.pending = false;
      component.tree = context[name](component.props);
      component.effects.splice(0).forEach(fn => fn());
      return component.tree;
    };
    component.flush = async () => {
      for (let i = 0; i < 12; i++) { await Promise.resolve(); if (component.pending) component.render(); }
      return component.tree;
    };
    component.render();
    return component;
  }
  return {context, target, mount};
}
function nodes(tree) {
  if (tree == null || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props.children)];
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return text(tree.props.children);
}
function find(component, predicate) {
  const node = nodes(component.tree).find(predicate);
  assert.ok(node, "Rendered control not found");
  return node;
}
function button(component, label) { return find(component, n => n.type === "button" && text(n) === label); }
function change(node, value) { return node.props.onChange({target:{value}}); }
function trade(id, pnl, extra = {}) {
  return {id, date:"2026-09-01", entry_time:"09:" + String(30 + id).padStart(2,"0"), exit_time:"10:00", direction:"Buy", product:"MES", entry_price:7000, exit_price:7010, duration:5, pnl_dollars:pnl, ...extra};
}
let count = 0;
async function test(name, fn) { await fn(); count++; console.log("OK - " + name); }
function near(a,b) { assert.ok(Math.abs(a-b) < 1e-9, `${a} != ${b}`); }

async function main() {
  await test("Actual app compiles with JSX/Babel", () => {});
  await test("Avg Win reacts only to wins; BE boundaries stay inclusive", () => {
    const {context:c} = environment();
    const base = [trade(1,1000),trade(2,-500),trade(3,150),trade(4,-150)];
    const s = c.calcStats(base,500);
    assert.equal(s.avgW,2); assert.equal(s.be,2); assert.equal(s.wr,50);
    assert.equal(c.calcStats([...base,trade(5,2000)],500).avgW,3);
    assert.equal(c.calcStats([...base,trade(5,-1000)],500).avgW,2);
    assert.equal(c.calcStats([...base,trade(5,100)],500).avgW,2);
    assert.equal(c.getTradeResult(trade(1,150.01)),"Win");
    assert.equal(c.getTradeResult(trade(1,-150.01)),"Loss");
    assert.equal(c.calcStats([],500),null);
  });
  await test("Recovery factor uses chronological drawdown including BE and is R-scale invariant", () => {
    const {context:c} = environment();
    const trades = [trade(4,1000),trade(2,-500),trade(1,1000),trade(3,-100)];
    const before = JSON.stringify(trades);
    const s = c.calcStats(trades,500);
    near(s.totalR,2.8); near(s.maxDD,1.2); near(s.rf,2.8/1.2);
    near(c.calcStats(trades,1000).rf,s.rf);
    assert.equal(JSON.stringify(trades),before);
    assert.equal(c.calcStats([trade(1,500)],500).rf,Infinity);
    assert.equal(c.calcStats([trade(1,-500)],500).rf,-1);
    assert.equal(c.calcStats([trade(1,0)],500).rf,0);
  });
  await test("Profit Factor without Loss is unbounded, not the old placeholder 99", () => {
    const {context:c}=environment();
    const s=c.calcStats([trade(1,500),trade(2,-100)],500);
    assert.equal(s.pf,Infinity); assert.equal(c.fmtPfValue(s),"\u221E");
    assert.equal(c.calcStats([trade(1,500),trade(2,-250)],500).pf,2);
    assert.equal(c.calcStats([trade(1,-250)],500).pf,0);
    assert.equal(c.calcStats([trade(1,0)],500).pf,0);
  });
  await test("100 independent sequence oracles agree with streaks, totals, Avg Win and Recovery", () => {
    const {context:c} = environment();
    let seed = 17;
    for(let run=0;run<100;run++) {
      const trades = Array.from({length:20},(_,i) => {
        seed = (seed*1664525+1013904223) >>> 0;
        return trade(i, (seed%401-200)*10);
      });
      let sum=0,peak=0,dd=0,w=0,l=0,mw=0,ml=0;
      trades.forEach(t => { sum+=t.pnl_dollars/500; peak=Math.max(peak,sum); dd=Math.max(dd,peak-sum); w=t.pnl_dollars>150?w+1:0; l=t.pnl_dollars< -150?l+1:0; mw=Math.max(mw,w); ml=Math.max(ml,l); });
      const s=c.calcStats(trades.slice().reverse(),500);
      near(s.totalR,sum); near(s.maxDD,dd); near(s.rf,dd?sum/dd:sum>0?Infinity:0);
      assert.equal(s.maxConsecW,mw); assert.equal(s.maxConsecL,ml);
      const wins=trades.filter(t=>t.pnl_dollars>150);
      near(s.avgW,wins.length?wins.reduce((a,t)=>a+t.pnl_dollars,0)/wins.length/500:0);
    }
  });
  await test("Numeric-string P&L adds numerically in Dashboard and Calendar", () => {
    const {context:c} = environment();
    const t=[trade(1,"500"),trade(2,"-200")];
    assert.equal(c.calcStats(t,500).totalD,300);
    assert.ok(text(c.DayTradeList({trades:t,rv:500,date:t[0].date})).includes("+0.60R"));
    assert.equal(c.calcStats([trade(1,500,{duration:"5"}),trade(2,1000,{duration:"15"})],500).avgDurW,10);
  });
  await test("Equity Curve does not round R before calculating dollar drawdown", () => {
    const e=environment(), trades=[trade(1,1000),trade(2,-800),trade(3,1)];
    const view=e.mount("EquityCurve",{trades,rv:750,showOnlyR:false});
    assert.ok(text(view.tree).includes("$800"));
    assert.ok(text(view.tree).includes("+$201"));
    assert.ok(!text(view.tree).includes("$802"));
    near(e.context.calcStats(trades,750).rf,201/800);
  });
  await test("Every partial OHLC write failure rolls back exactly, preserving unrelated keys", () => {
    const {context:c} = environment();
    const old={"jnl:v2:ohlc":"old candles","jnl:v2:trades":"old trades","external":"keep"};
    const next={"jnl:v2:ohlc":"new candles","jnl:v2:ohlcmeta":"new meta","jnl:v2:trades":"new trades"};
    for(let i=1;i<=3;i++) {
      const s=new FakeStorage(old); s.failAt=i;
      assert.throws(()=>c.writeJournalEntries(s,next),/Salvataggio non riuscito/);
      assert.deepEqual(s.values,old);
    }
    const s=new FakeStorage(old); c.writeJournalEntries(s,next);
    assert.deepEqual(s.values,{...old,...next});
    c.writeJournalEntries(s,next); assert.equal(s.writes,3);
  });
  await test("Rollback failure is explicitly reported; blocked reads do not write", () => {
    const {context:c} = environment();
    const s=new FakeStorage({a:"before"});
    const set=s.setItem.bind(s); let n=0;
    s.setItem=(k,v)=>{if(++n>1)throw new Error("blocked");set(k,v);};
    assert.throws(()=>c.writeJournalEntries(s,{a:"after",b:"new"}),/ripristino non riusciti/);
    const blocked=new FakeStorage(); blocked.readError=true;
    assert.throws(()=>c.writeJournalEntries(blocked,{a:"new"}),/Read blocked/);
    assert.equal(blocked.writes,0);
  });
  await test("Weekly first click, deselection and text save the current value immediately", async () => {
    const e=environment(), view=e.mount("SettimanaleView"); await view.flush();
    const week=find(view,n=>n.type==="input"&&n.props.type==="week").props.value;
    const key="jnl:v2:week:"+week;
    button(view,"Si").props.onClick(); await view.flush();
    assert.equal(JSON.parse(e.target.values[key]).piano_seguito_LUN,"Si");
    button(view,"Si").props.onClick(); await view.flush();
    assert.equal(JSON.parse(e.target.values[key]).piano_seguito_LUN,"");
    change(find(view,n=>n.type==="textarea"),"Latest note"); await view.flush();
    assert.equal(JSON.parse(e.target.values[key]).note_libere,"Latest note");
    assert.ok(text(view.tree).includes("Salvato OK"));
  });
  await test("Weekly failed write is visible, keeps the draft and allows retry", async () => {
    const e=environment(), view=e.mount("SettimanaleView"); await view.flush();
    e.target.failAt=1;
    button(view,"Si").props.onClick(); await view.flush();
    assert.ok(text(view.tree).includes("Salvataggio non riuscito"));
    assert.ok(!text(view.tree).includes("Salvato OK"));
    assert.equal(Object.keys(e.target.values).length,0);
    button(view,"SALVA").props.onClick(); await view.flush();
    assert.ok(text(view.tree).includes("Salvato OK"));
    assert.ok(Object.values(e.target.values)[0].includes('"Si"'));
  });
  await test("Weeks load independently and stale reads cannot replace the selected week", async () => {
    const e=environment({"jnl:v2:week:2026-W36":'{"note_libere":"first"}',"jnl:v2:week:2026-W37":'{"note_libere":"second"}'});
    let resolve;
    e.context.storageDelayed=new Promise(r=>resolve=r);
    vm.runInContext('storage.get = function(key){return key.endsWith("W36") ? storageDelayed : Promise.resolve({value:\'{"note_libere":"second"}\'});}',e.context);
    const view=e.mount("SettimanaleView");
    change(find(view,n=>n.type==="input"&&n.props.type==="week"),"2026-W36"); await view.flush();
    change(find(view,n=>n.type==="input"&&n.props.type==="week"),"2026-W37"); await view.flush();
    resolve({value:'{"note_libere":"old response"}'}); await view.flush();
    assert.equal(find(view,n=>n.type==="textarea").props.value,"second");
  });
  await test("Playbook enforces three tags, saves text without blur, and separates weeks", async () => {
    const e=environment(), view=e.mount("WeeklyPlaybookView"); await view.flush();
    for(const tag of ["REGIME","STOP MANAGEMENT","EXECUTION","RISK"]) { button(view,tag).props.onClick(); await view.flush(); }
    change(find(view,n=>n.type==="textarea"),"Keep the plan"); await view.flush();
    const data=JSON.parse(Object.values(e.target.values)[0]);
    assert.equal(data.tags.length,3); assert.equal(data.wrong,"Keep the plan");
    find(view,n=>n.type==="button"&&text(n).endsWith(" >")).props.onClick(); await view.flush();
    assert.equal(find(view,n=>n.type==="textarea").props.value,"");
  });
  await test("Unreadable weekly and execution data block editing, never replace with empty records", async () => {
    for(const name of ["SettimanaleView","WeeklyPlaybookView","ExecutionReviewView"]) {
      const e=environment(); e.target.readError=true;
      const view=e.mount(name,{trades:[]}); await view.flush();
      assert.ok(text(view.tree).includes("Lettura"));
      assert.equal(e.target.writes,0);
      if(name!=="ExecutionReviewView") assert.ok(find(view,n=>n.type==="fieldset").props.disabled);
      else assert.ok(!nodes(view.tree).some(n=>n.type==="button"));
    }
  });
  await test("R settings reject invalid values and preserve the form on write failure", async () => {
    const e=environment(); let saved;
    const view=e.mount("SettingsModal",{rv:500,onSave:v=>{saved=v;throw new Error("Quota");}});
    for(const v of ["-500","0","","Infinity","oops"]) {
      change(find(view,n=>n.type==="input"&&n.props.type==="number"),v); await view.flush();
      await button(view,"SALVA").props.onClick(); await view.flush();
      assert.equal(saved,undefined); assert.ok(text(view.tree).includes("maggiore di zero"));
    }
    change(find(view,n=>n.type==="input"&&n.props.type==="number"),"750"); await view.flush();
    await button(view,"SALVA").props.onClick(); await view.flush();
    assert.equal(saved,750); assert.ok(text(view.tree).includes("Quota"));
  });
  await test("Manual Initial SL replaces/removes every legacy alias without changing trade data", () => {
    const {context:c}=environment();
    for(const alias of ["manual_initial_stop","initial_stop_manual","initial_stop_price","initial_stop","initial_sl_price","initial_sl"]) {
      const old=trade(1,500,{[alias]:6990,final_stop_price:7000});
      const next=c.withManualInitialStop(old,"6980");
      assert.equal(c.initialStopInfoForTrade(next).price,6980);
      assert.equal(c.initialRiskPointsForTrade(next),20);
      assert.equal(c.initialStopInfoForTrade(c.withManualInitialStop(next,"")).price,null);
      assert.equal(old[alias],6990); assert.equal(next.final_stop_price,7000);
    }
    assert.throws(()=>c.withManualInitialStop(trade(1,0),"-1"));
    assert.throws(()=>c.withManualInitialStop(trade(1,0),"12junk"));
    assert.equal(c.executionRForExitPrice(trade(1,100,{direction:"Long",initial_stop_price:6990}),7010),1);
  });
  await test("Stop editor never confirms a failed save", async () => {
    const e=environment(), view=e.mount("InitialStopField",{trade:trade(1,0),stopInfo:{price:6990,label:"Manual"},stopCol:"red",onSave:async()=>{throw new Error("Save failed");}});
    await button(view,"SALVA SL").props.onClick(); await view.flush();
    assert.ok(text(view.tree).includes("Save failed")); assert.ok(!text(view.tree).includes("SALVATO"));
  });
  await test("App load failures block the journal and keep backup access", async () => {
    const e=environment({"jnl:v2:trades":"broken JSON"});
    const view=e.mount("Journal"); await view.flush();
    assert.ok(text(view.tree).includes("Lettura del journal non riuscita"));
    button(view,"IMPOSTAZIONI"); assert.equal(e.target.writes,0);
  });
  await test("Invalid stored R uses a visible fallback, never negative metrics", async () => {
    const e=environment({"jnl:v2:settings":'{"rv":-500}'});
    const view=e.mount("Journal"); await view.flush();
    assert.ok(text(view.tree).includes("Valore R salvato non valido"));
    const dashboard=find(view,n=>n.type===e.context.Dashboard);
    assert.equal(dashboard.props.rv,250);
    assert.equal(e.target.values["jnl:v2:settings"],'{"rv":-500}');
  });
  await test("Trade stop save and settings update change state only after persistence", async () => {
    const original=[trade(1,500,{manual_initial_stop:6990})];
    const e=environment({"jnl:v2:trades":JSON.stringify(original),"jnl:v2:settings":'{"rv":500,"future":"keep"}'});
    const view=e.mount("Journal"); await view.flush();
    button(view,"CALENDARIO").props.onClick(); await view.flush();
    let calendar=find(view,n=>n.type===e.context.CalendarioView);
    e.target.failAt=e.target.writes+1;
    await assert.rejects(calendar.props.onUpdateInitialStop(1,"6980")); await view.flush();
    assert.equal(JSON.parse(e.target.values["jnl:v2:trades"])[0].manual_initial_stop,6990);
    calendar=find(view,n=>n.type===e.context.CalendarioView);
    assert.equal(calendar.props.trades[0].manual_initial_stop,6990);
    await calendar.props.onUpdateInitialStop(1,"6980"); await view.flush();
    assert.equal(JSON.parse(e.target.values["jnl:v2:trades"])[0].initial_stop_price,6980);
    button(view,"settings").props.onClick(); await view.flush();
    const settings=find(view,n=>n.type===e.context.SettingsModal);
    await settings.props.onSave(750); await view.flush();
    assert.deepEqual(JSON.parse(e.target.values["jnl:v2:settings"]),{rv:750,future:"keep"});
  });
  await test("CSV export preserves zero and standard escaped quotes", () => {
    const e=environment(), view=e.mount("ExportModal",{trades:[trade(1,0,{duration:0,notes:'A "quote", line\nnext'})],rv:500});
    const csv=find(view,n=>n.type==="textarea").props.value;
    assert.ok(csv.includes('"0","0.00","BE"'));
    assert.ok(csv.includes('"A ""quote"", line\nnext"'));
  });
  await test("Execution failed save retains the complete form; retry persists one review", async () => {
    const e=environment(), view=e.mount("ExecutionReviewView",{trades:[trade("qa",500,{entry_time:"10:00",initial_stop_price:6990})]});
    await view.flush(); button(view,"+ ADD EXECUTION REVIEW").props.onClick(); await view.flush();
    change(find(view,n=>n.type==="select"&&text(n).includes("Select a trade...")),"qa"); await view.flush();
    change(find(view,n=>n.type==="select"&&text(n).includes("Fixed Target")),"Fixed Target"); await view.flush();
    button(view,"YES").props.onClick(); await view.flush();
    change(find(view,n=>n.type==="input"&&n.props.type==="number"),"6990"); await view.flush();
    change(find(view,n=>n.type==="textarea"),"A decision worth keeping"); await view.flush();
    e.target.failAt=1;
    await button(view,"SAVE REVIEW").props.onClick(); await view.flush();
    assert.ok(text(view.tree).includes("Salvataggio non riuscito"));
    assert.equal(find(view,n=>n.type==="textarea").props.value,"A decision worth keeping");
    assert.equal(e.target.values["jnl:v2:execution_reviews"],undefined);
    await button(view,"SAVE REVIEW").props.onClick(); await view.flush();
    assert.equal(JSON.parse(e.target.values["jnl:v2:execution_reviews"]).length,1);
    assert.ok(!nodes(view.tree).some(n=>n.type==="textarea"));
    e.target.failAt=e.target.writes+1;
    await button(view,"DELETE").props.onClick(); await view.flush();
    assert.equal(JSON.parse(e.target.values["jnl:v2:execution_reviews"]).length,1);
    button(view,"EDIT");
  });
  await test("Import failure preserves original trade state and prevents duplicate IDs on retry", async () => {
    const old=[trade(1,500)], added=trade(2,-500); let updated,closed=false;
    const e=environment({"jnl:v2:trades":JSON.stringify(old)});
    e.context.parseTradovateCSV=()=>({trades:[added,added],errors:[]});
    const view=e.mount("ImportModal",{trades:old,setTrades:t=>updated=t,onClose:()=>closed=true});
    find(view,n=>n.type==="input"&&n.props.type==="file").props.onChange({target:{files:[{text:"fixture"}]}}); await view.flush();
    e.target.failAt=1;
    await button(view,"IMPORTA 2 TRADE").props.onClick(); await view.flush();
    assert.equal(updated,undefined); assert.equal(closed,false);
    assert.equal(JSON.parse(e.target.values["jnl:v2:trades"]).length,1);
    await button(view,"IMPORTA 2 TRADE").props.onClick(); await view.flush();
    assert.equal(updated.length,2); assert.equal(closed,true);
  });
  await test("TradingView accepts large sorted exports, invalid replacements disable save", async () => {
    const e=environment(); let closed=false;
    e.context.parseTWCsv=text=>text==="bad"?[]:Array.from({length:150000},(_,i)=>({time:1788273000+i*60,high:7010,low:6990}));
    const view=e.mount("TWImportModal",{onSave:async()=>{throw new Error("Quota");},onClose:()=>closed=true});
    find(view,n=>n.type==="input"&&n.props.type==="file").props.onChange({target:{files:[{text:"large"}]}}); await view.flush();
    assert.ok(text(view.tree).includes("150000 candele"));
    await button(view,"SALVA E ATTIVA").props.onClick(); await view.flush();
    assert.ok(text(view.tree).includes("Quota")); assert.equal(closed,false);
    find(view,n=>n.type==="input"&&n.props.type==="file").props.onChange({target:{files:[{text:"bad"}]}}); await view.flush();
    assert.ok(button(view,"SALVA E ATTIVA").props.disabled);
    assert.ok(!text(view.tree).includes("150000 candele"));
    assert.ok(text(view.tree).includes("CSV NON RICONOSCIUTO"));
  });
  await test("TradingView rejects malformed files and incomplete trade windows", async () => {
    const e=environment();
    assert.throws(() => e.context.parseTWCsv(""), /file e vuoto/);
    assert.throws(() => e.context.parseTWCsv("foo,bar,baz\n1,2,3"), /colonne TradingView/);

    const linked=trade("m1",500,{date:"2026-09-01",entry_time:"09:30",exit_time:"09:32",product:"MES",initial_stop_price:6990});
    const start=e.context.etToUnix(linked.date,linked.entry_time);
    const complete=[-1,0,1,2,3].map(i=>({time:start+i*60,high:7010+i,low:6990-i}));
    const valid=e.context.calcMaeMfe(linked,complete,[]);
    assert.equal(valid.available,true);
    assert.equal(valid.candles,3);
    assert.equal(valid.timeframe_seconds,60);

    const incomplete=complete.filter(c=>c.time!==start+60);
    const rejected=e.context.calcMaeMfe(linked,incomplete,[]);
    assert.equal(rejected.available,false);
    assert.match(rejected.reason,/coverage incomplete/);
    assert.throws(
      () => e.context.validateTWOhlcImportCoverage([linked],incomplete,"ES"),
      /CSV INCOMPLETO/
    );
  });
  await test("Actual OHLC importer rolls back candles and meta if the trade-cache write fails", async () => {
    const original=[trade(1,500)];
    const stored={"jnl:v2:trades":JSON.stringify(original),"jnl:v2:ohlc":"[]","jnl:v2:ohlcmeta":'{"days":0}'};
    const e=environment(stored),view=e.mount("Journal"); await view.flush();
    button(view,"CALENDARIO").props.onClick(); await view.flush();
    find(view,n=>n.type===e.context.CalendarioView).props.onTWImport(); await view.flush();
    const modal=find(view,n=>n.type===e.context.TWImportModal);
    const first=e.context.etToUnix("2026-09-01","09:35");
    const completeBars=Array.from({length:6},(_,i)=>({time:first+i*300,high:7010+i,low:6990-i}));
    e.target.failAt=e.target.writes+3;
    await assert.rejects(modal.props.onSave(completeBars,{days:1}));
    await view.flush();
    assert.deepEqual(e.target.values,stored);
    assert.equal(find(view,n=>n.type===e.context.CalendarioView).props.ohlcMeta.days,0);
  });
  console.log(`OK - ${count} audit groups passed (including 100 sequence cases)`);
}
module.exports = {environment, nodes, text, find, button, change, FakeStorage};
if (require.main === module) main().catch(error=>{console.error(error);process.exitCode=1;});
