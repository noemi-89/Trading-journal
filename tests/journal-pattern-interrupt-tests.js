const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {environment,nodes,text,find,button} = require("./journal-audit-tests");

const html = fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const UUID_AM = "11111111-2222-4333-8444-555555555555";
const UUID_PM = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let count = 0;
async function test(name,fn) { await fn(); count++; console.log("OK - "+name); }
function timerHarness(e) {
  let nextId = 1;
  const jobs = new Map();
  e.context.setTimeout = function(fn,delay) { const id=nextId++; jobs.set(id,{fn,delay}); return id; };
  e.context.clearTimeout = function(id) { jobs.delete(id); };
  return {
    run(delay) {
      const entry = Array.from(jobs.entries()).find(function(pair){return pair[1].delay===delay;});
      assert.ok(entry,"Timer "+delay+" ms non trovato");
      jobs.delete(entry[0]); entry[1].fn();
    },
    count(delay) { return Array.from(jobs.values()).filter(function(job){return job.delay===delay;}).length; },
  };
}
function installUuid(e,value) { e.context.crypto={randomUUID:function(){return value;}}; }
function checks(view) { return nodes(view.tree).filter(function(node){return node.type==="input"&&node.props.type==="checkbox";}); }
async function confirmSafety(view) {
  let list=checks(view);
  list[0].props.onChange({target:{checked:true}}); await view.flush();
  list=checks(view);
  list[1].props.onChange({target:{checked:true}}); await view.flush();
}
function holdButton(view) { return find(view,function(node){return node.type==="button"&&String(node.props.className||"").includes("trading-guard-hold");}); }
function pointerEvent() { return {type:"pointerdown",button:0,pointerId:1,preventDefault(){},currentTarget:{setPointerCapture(){}}}; }
function successPayload(session) {
  return {
    ok:true,code:"block_started",requestId:session==="AM"?UUID_AM:UUID_PM,status:"Enabled",session:session,
    blockName:"TRADING GUARD "+session+" SESSION",cutoffLabel:session==="AM"?"12:00 ET":"16:00 ET",
    message:"TRADINGVIEW BLOCCATO FINO ALLE "+(session==="AM"?"12:00 ET":"16:00 ET"),instruction:"ALZATI E VAI SULLA BIKE.",
  };
}

async function main() {
  await test("Pattern Interrupt code compiles with the Journal JSX",function(){});
  await test("The red STOP remains available during load, normal use and a storage failure",async function(){
    const normal=environment(),loading=normal.mount("Journal");
    find(loading,function(n){return n.type===normal.context.TradingGuardStopButton;});
    const renderedButton=normal.mount("TradingGuardStopButton",{onOpen:function(){}});
    assert.equal(text(renderedButton.tree),"STOP");
    await loading.flush();
    assert.equal(nodes(loading.tree).filter(function(n){return n.type===normal.context.TradingGuardStopButton;}).length,1);
    const failed=environment(); failed.target.readError=true;
    const failedView=failed.mount("Journal"); await failedView.flush();
    assert.ok(text(failedView.tree).includes("Lettura del journal non riuscita"));
    find(failedView,function(n){return n.type===failed.context.TradingGuardStopButton;});
  });
  await test("The dedicated tab contains the exact rules, safety flow and ten-minute reset",async function(){
    const e=environment(),view=e.mount("Journal"); await view.flush();
    button(view,"PATTERN INTERRUPT").props.onClick(); await view.flush();
    find(view,function(n){return n.type===e.context.PatternInterruptView;});
    const pattern=e.mount("PatternInterruptView",{onStop:function(){}});
    for(const exact of [
      "NY AM SESSION: 2 LOSS = STOP","NY PM SESSION: 2 LOSS = STOP","NY DAILY LIMIT: 3 LOSS = STOP",
      "FLAT \u2192 CANCEL ALL \u2192 VERIFY \u2192 STOP \u2192 BIKE","BIKE RESET","10 MINUTI",
      "Questa sezione non legge ne modifica i trade del Journal.","VERIFICA PONTE",
      "Controllo sicuro: non attiva alcun blocco."
    ]) assert.ok(text(pattern.tree).includes(exact),exact);
    assert.equal(e.target.writes,0);
  });
  await test("The bridge check is an explicit read-only health request",async function(){
    const e=environment(),calls=[];
    e.context.fetch=async function(url,options){calls.push({url,options});return{ok:true,json:async function(){return{
      ok:true,ready:true,code:"ready",service:"Trading Guard Local",timezone:"America/New_York",listenAddress:"127.0.0.1"
    };}};};
    const view=e.mount("PatternInterruptView",{onStop:function(){}}); await view.flush();
    button(view,"VERIFICA PONTE").props.onClick(); await view.flush();
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,"http://127.0.0.1:48173/v1/health");
    assert.equal(calls[0].options.method,"GET");
    assert.equal(e.target.writes,0);
    assert.ok(text(view.tree).includes("PONTE PRONTO \u2014 COLD TURKEY DISPONIBILE."));
  });
  await test("The bridge check fails closed on an unverified health response",async function(){
    const e=environment();
    e.context.fetch=async function(){return{ok:true,json:async function(){return{ok:true,ready:false,code:"cold_turkey_ui_running"};}};};
    const view=e.mount("PatternInterruptView",{onStop:function(){}}); await view.flush();
    button(view,"VERIFICA PONTE").props.onClick(); await view.flush();
    assert.ok(text(view.tree).includes("PONTE NON PRONTO \u2014 AVVIA TRADING GUARD LOCAL."));
  });
  await test("Opening STOP requires both exact manual confirmations",async function(){
    const e=environment(),view=e.mount("TradingGuardEmergencyModal",{onClose:function(){}}); await view.flush();
    assert.deepEqual(nodes(view.tree).filter(function(node){return node.type==="label"&&node.props.className==="trading-guard-confirmation";}).map(text),[
      "CONFERMO: POSIZIONE FLAT","CONFERMO: NESSUN ORDINE PENDENTE"
    ]);
    assert.equal(holdButton(view).props.disabled,true);
    checks(view)[0].props.onChange({target:{checked:true}}); await view.flush();
    assert.equal(holdButton(view).props.disabled,true);
    checks(view)[1].props.onChange({target:{checked:true}}); await view.flush();
    assert.equal(holdButton(view).props.disabled,false);
    assert.ok(text(view.tree).includes("Trading Guard non controlla la posizione"));
  });
  await test("An early pointer release cancels activation without any request",async function(){
    const e=environment(),clock=timerHarness(e),calls=[]; installUuid(e,UUID_AM); e.context.fetch=function(){calls.push(1);};
    const view=e.mount("TradingGuardEmergencyModal",{onClose:function(){}}); await view.flush(); await confirmSafety(view);
    holdButton(view).props.onPointerDown(pointerEvent()); await view.flush();
    assert.equal(clock.count(2000),1);
    holdButton(view).props.onPointerUp({}); await view.flush();
    assert.equal(clock.count(2000),0);
    assert.equal(calls.length,0);
  });
  await test("Keyboard hold is cancellable and repeated keydown cannot queue duplicates",async function(){
    const e=environment(),clock=timerHarness(e),calls=[]; installUuid(e,UUID_AM); e.context.fetch=function(){calls.push(1);};
    const view=e.mount("TradingGuardEmergencyModal",{onClose:function(){}}); await view.flush(); await confirmSafety(view);
    const key={key:" ",repeat:false,preventDefault(){}};
    holdButton(view).props.onKeyDown(key); holdButton(view).props.onKeyDown(key);
    assert.equal(clock.count(2000),1);
    holdButton(view).props.onKeyUp({key:" ",preventDefault(){}}); await view.flush();
    assert.equal(clock.count(2000),0); assert.equal(calls.length,0);
  });
  await test("A full hold sends exactly one idempotent, stop-only request with no Journal write",async function(){
    const e=environment(),clock=timerHarness(e),calls=[]; installUuid(e,UUID_AM);
    e.context.fetch=async function(url,options){calls.push({url,options});return{ok:true,json:async function(){return successPayload("AM");}};};
    const view=e.mount("TradingGuardEmergencyModal",{onClose:function(){}}); await view.flush(); await confirmSafety(view);
    const control=holdButton(view); control.props.onPointerDown(pointerEvent()); control.props.onPointerDown(pointerEvent());
    clock.run(2000); await view.flush();
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,"http://127.0.0.1:48173/v1/stop");
    assert.equal(calls[0].options.method,"POST");
    assert.equal(calls[0].options.headers["Content-Type"],"application/json");
    assert.equal(calls[0].options.headers["X-Trading-Guard-Intent"],"stop-after-flat-confirmation");
    assert.deepEqual(JSON.parse(calls[0].options.body),{requestId:UUID_AM,confirmedFlat:true,confirmedNoPendingOrders:true});
    assert.equal(e.target.writes,0);
    assert.ok(text(view.tree).includes("TRADINGVIEW BLOCCATO FINO ALLE 12:00 ET"));
    assert.ok(text(view.tree).includes("ALZATI E VAI SULLA BIKE."));
    assert.ok(text(view.tree).includes("NY AM SESSION"));
  });
  await test("Pending HTTP never renders a false success before verified confirmation",async function(){
    const e=environment(),clock=timerHarness(e); installUuid(e,UUID_AM);
    let resolveFetch;
    e.context.fetch=function(){return new Promise(function(resolve){resolveFetch=resolve;});};
    const view=e.mount("TradingGuardEmergencyModal",{onClose:function(){}}); await view.flush(); await confirmSafety(view);
    holdButton(view).props.onPointerDown(pointerEvent()); clock.run(2000); await view.flush();
    assert.ok(text(view.tree).includes("ATTENDO CONFERMA DA COLD TURKEY"));
    assert.ok(!text(view.tree).includes("TRADINGVIEW BLOCCATO FINO ALLE"));
    resolveFetch({ok:true,json:async function(){return successPayload("AM");}}); await view.flush();
    assert.ok(text(view.tree).includes("TRADINGVIEW BLOCCATO FINO ALLE 12:00 ET"));
  });
  await test("PM session and cutoff come only from the verified helper response",async function(){
    const e=environment(),clock=timerHarness(e); installUuid(e,UUID_PM);
    e.context.fetch=async function(){return{ok:true,json:async function(){return successPayload("PM");}};};
    const view=e.mount("TradingGuardEmergencyModal",{onClose:function(){}}); await view.flush(); await confirmSafety(view);
    holdButton(view).props.onPointerDown(pointerEvent()); clock.run(2000); await view.flush();
    assert.ok(text(view.tree).includes("NY PM SESSION"));
    assert.ok(text(view.tree).includes("TRADINGVIEW BLOCCATO FINO ALLE 16:00 ET"));
    assert.ok(!text(view.tree).includes("12:00 ET"));
  });
  await test("Malformed, contradictory and failed responses show the exact strong failure",async function(){
    const badPayloads=[
      {...successPayload("AM"),ok:false},
      {...successPayload("AM"),status:"Disabled"},
      {...successPayload("AM"),cutoffLabel:"16:00 ET"},
      {...successPayload("PM"),session:"XX"},
      {...successPayload("AM"),message:"Blocco forse attivo."},
      {...successPayload("AM"),instruction:""},
      {...successPayload("AM"),requestId:UUID_PM},
      {...successPayload("AM"),code:"unknown"},
      {...successPayload("AM"),blockName:"TRADING GUARD PM SESSION"},
    ];
    for(const payload of badPayloads) {
      const e=environment(),clock=timerHarness(e); installUuid(e,UUID_AM);
      e.context.fetch=async function(){return{ok:true,json:async function(){return payload;}};};
      const view=e.mount("TradingGuardEmergencyModal",{onClose:function(){}}); await view.flush(); await confirmSafety(view);
      holdButton(view).props.onPointerDown(pointerEvent()); clock.run(2000); await view.flush();
      assert.ok(text(view.tree).includes("BLOCCO NON CONFERMATO \u2014 APRI COLD TURKEY ORA."));
      assert.ok(!text(view.tree).includes("TRADINGVIEW BLOCCATO FINO ALLE"));
    }
    const e=environment(),clock=timerHarness(e); installUuid(e,UUID_AM);
    e.context.fetch=async function(){throw new Error("offline");};
    const view=e.mount("TradingGuardEmergencyModal",{onClose:function(){}}); await view.flush(); await confirmSafety(view);
    holdButton(view).props.onPointerDown(pointerEvent()); clock.run(2000); await view.flush();
    assert.ok(text(view.tree).includes("BLOCCO NON CONFERMATO \u2014 APRI COLD TURKEY ORA."));
  });
  await test("A retry after an unknown outcome reuses the same idempotency request ID",async function(){
    const e=environment(),clock=timerHarness(e),bodies=[]; installUuid(e,UUID_AM);
    let attempt=0;
    e.context.fetch=async function(url,options){
      bodies.push(JSON.parse(options.body));
      attempt++;
      if(attempt===1) throw new Error("response lost");
      return{ok:true,json:async function(){return successPayload("AM");}};
    };
    const view=e.mount("TradingGuardEmergencyModal",{onClose:function(){}}); await view.flush(); await confirmSafety(view);
    holdButton(view).props.onPointerDown(pointerEvent()); clock.run(2000); await view.flush();
    assert.ok(text(view.tree).includes("BLOCCO NON CONFERMATO"));
    holdButton(view).props.onPointerDown(pointerEvent()); clock.run(2000); await view.flush();
    assert.equal(bodies.length,2);
    assert.equal(bodies[0].requestId,UUID_AM);
    assert.equal(bodies[1].requestId,UUID_AM);
    assert.ok(text(view.tree).includes("TRADINGVIEW BLOCCATO FINO ALLE 12:00 ET"));
  });
  await test("A silent local helper is aborted after twenty seconds and never produces false success",async function(){
    const e=environment(),clock=timerHarness(e); installUuid(e,UUID_AM);
    e.context.AbortController=class {
      constructor(){this.signal={aborted:false,listeners:[],addEventListener:function(name,fn){if(name==="abort")this.listeners.push(fn);}};}
      abort(){this.signal.aborted=true;this.signal.listeners.forEach(function(fn){fn();});}
    };
    e.context.fetch=function(url,options){
      return new Promise(function(resolve,reject){options.signal.addEventListener("abort",function(){reject(new Error("AbortError"));});});
    };
    const view=e.mount("TradingGuardEmergencyModal",{onClose:function(){}}); await view.flush(); await confirmSafety(view);
    holdButton(view).props.onPointerDown(pointerEvent()); clock.run(2000); await view.flush();
    assert.ok(text(view.tree).includes("ATTENDO CONFERMA DA COLD TURKEY"));
    assert.equal(clock.count(20000),1);
    clock.run(20000); await view.flush();
    assert.ok(text(view.tree).includes("BLOCCO NON CONFERMATO \u2014 APRI COLD TURKEY ORA."));
    assert.ok(!text(view.tree).includes("TRADINGVIEW BLOCCATO FINO ALLE"));
  });
  await test("The response validator binds each NY session to its exact ET cutoff",function(){
    const e=environment(),c=e.context;
    assert.equal(c.validateTradingGuardResponse(successPayload("AM"),UUID_AM).cutoffLabel,"12:00 ET");
    assert.equal(c.validateTradingGuardResponse(successPayload("PM"),UUID_PM).cutoffLabel,"16:00 ET");
    assert.equal(c.validateTradingGuardResponse({...successPayload("AM"),cutoffLabel:"16:00 ET"},UUID_AM),null);
    assert.equal(c.validateTradingGuardResponse({...successPayload("PM"),cutoffLabel:"12:00 ET"},UUID_PM),null);
    assert.equal(c.validateTradingGuardResponse(successPayload("AM"),UUID_PM),null);
  });
  await test("UUID generation is v4 and refuses an insecure fallback",function(){
    const e=environment(),c=e.context;
    assert.equal(c.createTradingGuardRequestId({randomUUID:function(){return UUID_AM;}}),UUID_AM);
    const deterministic={getRandomValues:function(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=i;return bytes;}};
    assert.match(c.createTradingGuardRequestId(deterministic),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.throws(function(){c.createTradingGuardRequestId({});},/UUID sicuro/);
  });
  await test("Guard implementation exposes only STOP plus read-only health, with no persistence or OFF API",function(){
    const guard=html.slice(html.indexOf("// PATTERN INTERRUPT / TRADING GUARD"),html.indexOf("// MAIN APP"));
    assert.ok(guard.includes('http://127.0.0.1:48173/v1/stop'));
    assert.ok(guard.includes('http://127.0.0.1:48173/v1/health'));
    assert.ok(guard.includes("TRADING_GUARD_TIMEOUT_MS = 20000"));
    assert.ok(!guard.includes("localStorage"));
    assert.ok(!guard.includes("storage.get"));
    assert.ok(!guard.includes("storage.set"));
    assert.ok(!html.includes("/v1/off"));
  });
  console.log("OK - "+count+" Pattern Interrupt / Trading Guard test groups passed");
}
main().catch(function(error){console.error(error);process.exitCode=1;});
