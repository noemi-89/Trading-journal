const assert = require("node:assert/strict");
const {environment,nodes,text,find,button,change,FakeStorage} = require("./journal-audit-tests");
const KEY = "jnl:v2:champion_mindset";
function radios(view) { return nodes(view.tree).filter(n=>n.type==="input"&&n.props.type==="radio"); }
function selected(view) { return radios(view).filter(n=>n.props.checked).map(n=>n.props.value); }
function chooseDate(e,view,date) { find(view,n=>n.type===e.context.MindsetDateWheel).props.onChange(date); }
function today(e) { return e.context.mindsetToday(); }
let count = 0;
async function test(name,fn) { await fn(); console.log("OK - " + name); count++; }
async function main() {
  await test("Header contains only dynamic trade count and motto, never the old market/R/OHLC line", async()=>{
    const e=environment({"jnl:v2:trades":JSON.stringify([{id:"one",date:"2026-09-01",pnl_dollars:500}])});
    const view=e.mount("Journal"); await view.flush();
    assert.equal(text(find(view,n=>n.props.className==="journal-trade-count")),"1 trade");
    assert.equal(text(find(view,n=>n.props.className==="journal-motto")),"VICTORY BELONGS TO THE MOST TENACIOUS.");
    const header=find(view,n=>n.props.className==="journal-header");
    assert.deepEqual(header.props.children.map(n=>n.props.className),["journal-identity","journal-motto","journal-settings"]);
    for(const legacy of ["ES FUTURES JOURNAL","1R = $","ES OHLC","NQ OHLC"]) assert.ok(!text(view.tree).includes(legacy));
    button(view,"CHAMPION MINDSET").props.onClick(); await view.flush();
    find(view,n=>n.type===e.context.ChampionMindsetView);
    button(view,"CALENDARIO").props.onClick(); await view.flush();
    find(view,n=>n.type===e.context.CalendarioView).props.onImport(); await view.flush();
    find(view,n=>n.type===e.context.ImportModal).props.setTrades([{id:1},{id:2},{id:3}]); await view.flush();
    assert.equal(text(find(view,n=>n.props.className==="journal-trade-count")),"3 trade");
  });
  await test("Empty journal reports zero trade rather than hardcoded 106",async()=>{
    const e=environment(),view=e.mount("Journal");await view.flush();
    assert.equal(text(find(view,n=>n.props.className==="journal-trade-count")),"0 trade");
  });
  await test("Today is local calendar date, with valid leap-day and month arithmetic",()=>{
    const {context:c}=environment();
    const local={getFullYear:()=>2026,getMonth:()=>8,getDate:()=>3};
    assert.equal(c.mindsetToday(local),"2026-09-03");
    assert.equal(c.mindsetDayNumber("2026-02-30"),null);
    assert.equal(c.mindsetDayNumber("bad"),null);
    assert.equal(c.mindsetShiftMonth("2026-03-31",-1),"2026-02-28");
    assert.equal(c.mindsetShiftMonth("2024-03-31",-1),"2024-02-29");
    assert.equal(c.mindsetShiftMonth("2026-01-31",-1),"2025-12-31");
    assert.equal(c.mindsetDateFromDay(c.mindsetDayNumber("2026-10-25")+1),"2026-10-26");
  });
  await test("All six exact statements and authors render left of the wheel without notes or analytics",async()=>{
    const e=environment(),view=e.mount("ChampionMindsetView");await view.flush();
    const expected=[
      "VICTORY BELONGS TO THE MOST TENACIOUS.","PRESSURE IS A PRIVILEGE.",
      "CHAMPIONS ARE DEFINED BY HOW THEY RECOVER.","REST AT THE END, NOT IN THE MIDDLE.","FIRST, YOU HAVE TO FINISH.",
      "NO MATTER WHAT HAPPENS, WE ARE BULLISH ON LIFE."
    ];
    assert.deepEqual(nodes(view.tree).filter(n=>n.props.className==="mindset-quote-text").map(text),expected);
    assert.deepEqual(nodes(view.tree).filter(n=>n.props.className==="mindset-author").map(text),[
      "\u2014 Roland-Garros","\u2014 Billie Jean King","\u2014 Serena Williams","\u2014 Kobe Bryant","\u2014 Michael Schumacher","\u2014 Noemi"
    ]);
    assert.equal(radios(view).length,6);assert.deepEqual(selected(view),[]);
    const layout=find(view,n=>n.props.className==="mindset-layout");
    assert.equal(layout.props.children[0].props.className,"mindset-quotes");
    assert.equal(layout.props.children[1].type,e.context.MindsetDateWheel);
    assert.equal(find(view,n=>n.type===e.context.MindsetDateWheel).props.value,today(e));
    assert.ok(!nodes(view.tree).some(n=>n.type==="textarea"||n.type===e.context.MetricCard));
    assert.equal(e.target.writes,0);
  });
  await test("Selection persists by ID, remains after remount and is replaced on the same date",async()=>{
    const e=environment(),view=e.mount("ChampionMindsetView");await view.flush();
    radios(view)[1].props.onChange();await view.flush();
    assert.deepEqual(JSON.parse(e.target.values[KEY]),{[today(e)]:"pressure"});
    const reopened=e.mount("ChampionMindsetView");await reopened.flush();
    assert.deepEqual(selected(reopened),["pressure"]);
    radios(reopened)[3].props.onChange();await reopened.flush();
    assert.deepEqual(selected(reopened),["rest"]);
    assert.deepEqual(JSON.parse(e.target.values[KEY]),{[today(e)]:"rest"});
    const writes=e.target.writes;
    radios(reopened)[3].props.onChange();await reopened.flush();assert.equal(e.target.writes,writes);
  });
  await test("Dates stay independent; an unassigned date has no selected quote",async()=>{
    const stored={"2025-01-01":"finish","2026-09-02":"recovery"};
    const e=environment({[KEY]:JSON.stringify(stored)}),view=e.mount("ChampionMindsetView");await view.flush();
    chooseDate(e,view,"2025-01-01");await view.flush();assert.deepEqual(selected(view),["finish"]);
    chooseDate(e,view,"2026-09-02");await view.flush();assert.deepEqual(selected(view),["recovery"]);
    chooseDate(e,view,"2026-09-05");await view.flush();assert.deepEqual(selected(view),[]);
    radios(view)[0].props.onChange();await view.flush();
    assert.deepEqual(JSON.parse(e.target.values[KEY]),{...stored,"2026-09-05":"tenacity"});
  });
  await test("Noemi's quote persists and preserves every previously supported quote ID",async()=>{
    const legacy={"2026-01-01":"tenacity","2026-01-02":"pressure","2026-01-03":"recovery","2026-01-04":"rest","2026-01-05":"finish"};
    const e=environment({[KEY]:JSON.stringify(legacy)}),view=e.mount("ChampionMindsetView");await view.flush();
    const date="2026-09-03";chooseDate(e,view,date);await view.flush();
    radios(view)[5].props.onChange();await view.flush();
    assert.deepEqual(JSON.parse(e.target.values[KEY]),{...legacy,[date]:"bullish_life"});
    const reopened=e.mount("ChampionMindsetView");await reopened.flush();
    chooseDate(e,reopened,date);await reopened.flush();assert.deepEqual(selected(reopened),["bullish_life"]);
    radios(reopened)[0].props.onChange();await reopened.flush();
    assert.deepEqual(JSON.parse(e.target.values[KEY]),{...legacy,[date]:"tenacity"});
  });
  await test("Saving a different date during a date change never selects the wrong statement",async()=>{
    const e=environment(),view=e.mount("ChampionMindsetView");await view.flush();
    const original=today(e);
    radios(view)[2].props.onChange();chooseDate(e,view,"2025-05-10");await view.flush();
    assert.deepEqual(selected(view),[]);
    assert.equal(JSON.parse(e.target.values[KEY])[original],"recovery");
  });
  await test("A write error keeps the previously saved selection and supports retry",async()=>{
    const e=environment();e.target.values[KEY]=JSON.stringify({[today(e)]:"pressure"});
    const view=e.mount("ChampionMindsetView");await view.flush();
    e.target.failAt=1;
    radios(view)[4].props.onChange();await view.flush();
    assert.deepEqual(selected(view),["pressure"]);
    assert.equal(JSON.parse(e.target.values[KEY])[today(e)],"pressure");
    assert.ok(text(view.tree).includes("Non salvato"));
    radios(view)[4].props.onChange();await view.flush();assert.deepEqual(selected(view),["finish"]);
    assert.ok(!text(view.tree).includes("Non salvato"));
  });
  await test("Malformed data and failed reads block selection without destroying the archive",async()=>{
    for(const raw of ['{broken','[]','{"2026-02-30":"finish"}','{"2026-09-03":"unknown"}']) {
      const e=environment({[KEY]:raw}),view=e.mount("ChampionMindsetView");await view.flush();
      assert.ok(radios(view).every(n=>n.props.disabled));
      assert.ok(text(view.tree).includes("Lettura Champion Mindset non riuscita"));
      assert.equal(e.target.values[KEY],raw);assert.equal(e.target.writes,0);
    }
    const e=environment();e.target.readError=true;
    const view=e.mount("ChampionMindsetView");await view.flush();
    assert.ok(radios(view).every(n=>n.props.disabled));assert.equal(e.target.writes,0);
  });
  await test("A save merges the latest archive, preserving other dates and every unrelated key",async()=>{
    const original={"jnl:v2:trades":"[]","jnl:v2:execution_reviews":"[]","jnl:v2:playbook:2026-W36":'{"change":"Keep this"}',external:"unchanged"};
    const e=environment(original),view=e.mount("ChampionMindsetView");await view.flush();
    e.target.values[KEY]='{"2024-01-01":"finish"}';
    radios(view)[0].props.onChange();await view.flush();
    assert.deepEqual(JSON.parse(e.target.values[KEY]),{"2024-01-01":"finish",[today(e)]:"tenacity"});
    for(const [k,v] of Object.entries(original)) assert.equal(e.target.values[k],v);
  });
  await test("Wheel supports click, daily arrows, month/year paging, and return to today",async()=>{
    const e=environment();let chosen;
    const view=e.mount("MindsetDateWheel",{value:"2026-09-03",onChange:d=>chosen=d});
    const option=find(view,n=>n.props.role==="option"&&n.props["aria-selected"]);
    assert.equal(option.props["aria-label"],"03 SEP 2026");
    const picker=find(view,n=>n.props.role==="listbox");
    picker.props.onKeyDown({key:"ArrowUp",preventDefault(){}});assert.equal(chosen,"2026-09-02");
    picker.props.onKeyDown({key:"ArrowDown",preventDefault(){}});assert.equal(chosen,"2026-09-04");
    picker.props.onKeyDown({key:"PageUp",preventDefault(){}});assert.equal(chosen,"2026-08-03");
    picker.props.onKeyDown({key:"PageDown",shiftKey:true,preventDefault(){}});assert.equal(chosen,"2027-09-03");
    find(view,n=>n.props["aria-label"]==="02 SEP 2026").props.onClick();assert.equal(chosen,"2026-09-02");
    picker.props.onKeyDown({key:"Home",preventDefault(){}});assert.equal(chosen,today(e));
  });
  await test("Vertical scroll selects the centered day and extends beyond the initial window",async()=>{
    const e=environment();let callback,chosen;
    e.context.setTimeout=fn=>{callback=fn;return 1;};
    const view=e.mount("MindsetDateWheel",{value:"2026-09-03",onChange:d=>{chosen=d;view.props.value=d;view.pending=true;}});
    let picker=find(view,n=>n.props.role==="listbox");
    const element={scrollTop:366*48};picker.props.ref.current=element;
    picker.props.onScroll({currentTarget:element});callback();await view.flush();
    assert.equal(chosen,"2026-09-04");
    picker=find(view,n=>n.props.role==="listbox");
    element.scrollTop=4*48;picker.props.onScroll({currentTarget:element});callback();await view.flush();
    assert.equal(element.scrollTop,365*48);
    assert.ok(nodes(view.tree).filter(n=>n.props.role==="option")[0].props["aria-label"].endsWith("2024"));
    assert.equal(find(view,n=>n.props.role==="option"&&n.props["aria-selected"]).props.id,"mindset-date-"+chosen);
  });
  await test("Backup and restore automatically include the new key losslessly",async()=>{
    const e=environment({[KEY]:'{"2026-09-03":"bullish_life","2026-09-02":"rest"}',"jnl:v2:trades":"[]"});
    const prepare=s=>{Object.defineProperty(s,"length",{get(){return Object.keys(s.values).length;}});s.key=i=>Object.keys(s.values)[i]??null;return s;};
    prepare(e.target);
    const backup=e.context.createJournalBackup(e.target,"2026-09-03T12:00:00.000Z");
    assert.equal(backup.items[KEY],e.target.values[KEY]);
    const restored=prepare(new FakeStorage({external:"keep"}));
    e.context.restoreJournalBackup(restored,backup);
    assert.equal(restored.values[KEY],e.target.values[KEY]);assert.equal(restored.values.external,"keep");
  });
  await test("Weekly Review / Playbook label changes without renaming the stored field",async()=>{
    const e=environment();const key="jnl:v2:playbook:"+e.context.getCurrentWeekId();
    e.target.values[key]=JSON.stringify({change:"Original improvement",tags:[]});
    const view=e.mount("WeeklyPlaybookView");await view.flush();
    assert.ok(text(view.tree).includes("What will I improve?"));assert.ok(!text(view.tree).includes("What will I change?"));
    assert.equal(nodes(view.tree).filter(n=>n.type==="textarea")[3].props.value,"Original improvement");
    assert.equal(e.target.writes,0);
    change(nodes(view.tree).filter(n=>n.type==="textarea")[3],"Updated improvement");await view.flush();
    assert.equal(JSON.parse(e.target.values[key]).change,"Updated improvement");
  });
  console.log(`OK - ${count} Champion Mindset / header / label test groups passed`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
