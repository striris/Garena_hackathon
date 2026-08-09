/* Deterministic Saltkin executor for the public v0.2 intent card. */
CF.bot = (function () {
  var E = CF.engine;
  function frontOf(state, i) { return E.laneOf(state, i); }
  function chooseIntent(state, side) {
    var beaconOwner = state.tiles[state.beacon].owner;
    return { id:'AUTO', intent: beaconOwner === side ? 'DEFEND' : 'BEACON', region:'BEACON', front:frontOf(state,state.beacon), posture:beaconOwner===side?'DEFEND':'RAID', priority:'BEACON' };
  }
  function normalise(state, side, card) {
    var base = chooseIntent(state, side), c = card || {};
    var intent=c.intent||(c.posture==='PRESS'?'RAID':c.posture==='GROW'?'EXPAND':c.posture==='HOLD'?'DEFEND':base.intent);
    return { id:c.id||base.id, intent:intent, region:c.region||c.front||base.region,
      front:c.front||c.region||base.front, posture:c.posture||c.intent||base.posture, priority:c.priority||c.region||base.priority };
  }
  function distance(state, a, b) { return Math.abs(a%state.W-b%state.W)+Math.abs(((a/state.W)|0)-((b/state.W)|0)); }
  function legal(state, side) {
    var out=[];
    state.tiles.forEach(function(t,i){
      if (!t.land) return;
      var ex=E.canExpand(state,side,i,[]); if(ex!=null) out.push({type:'expand',from:ex,to:i});
      var ra=E.canRaid(state,side,i); if(ra!=null) out.push({type:'raid',from:ra,to:i});
      if(t.owner===side) out.push({type:'guard',from:i,to:i});
    });
    return out;
  }
  function score(state, side, o, card) {
    var s=0, foe=side===1?2:1, t=state.tiles[o.to], targetRegion=card.region;
    if(targetRegion==='BEACON') s+=20/(1+distance(state,o.to,state.beacon));
    else if(targetRegion==='CAPITAL') s+=18/(1+distance(state,o.to,state.capitals[foe]));
    else if(frontOf(state,o.to)===targetRegion) s+=12;
    if(o.to===state.beacon) s+=18;
    if(o.type==='raid') s+=(card.intent==='RAID'?14:5)+(t.capital?35:0);
    if(o.type==='expand') s+=(card.intent==='EXPAND'?14:6);
    if(o.type==='guard') s+=(card.intent==='DEFEND'?14:2)+(o.to===state.beacon?14:0)+(t.capital?10:0);
    return s;
  }
  function plan(state, side, forceGuard, doctrine) {
    var card=normalise(state,side,doctrine), list=legal(state,side);
    if(forceGuard) card.intent='DEFEND';
    list.sort(function(a,b){return score(state,side,b,card)-score(state,side,a,card)||a.to-b.to;});
    var first=list[0], second=null;
    if(first){
      if(first.type==='raid' && (state.tiles[first.to].capital || card.intent==='RAID')) second={type:'raid',from:first.from,to:first.to};
      else second=list.filter(function(o){return !(o.type==='guard'&&first.type==='guard'&&o.to===first.to)&&!(o.type==='expand'&&first.type==='expand'&&o.to===first.to);})[0];
    }
    var orders=[first,second].filter(Boolean).slice(0,2);
    return { orders:orders, card:card, strategy:card, effort:card, mood:card.intent.toLowerCase(), spent:0, boosts:0,
      military:orders.filter(function(o){return o.type==='raid'||o.type==='guard';}).length };
  }
  return { plan:plan, chooseStrategyCard:chooseIntent, chooseEffort:function(s,side,d){return normalise(s,side,d);}, chooseMood:function(s,side){return chooseIntent(s,side).intent.toLowerCase();} };
})();
