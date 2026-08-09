/* The v0.2 world has one readable event: move the Beacon. */
CF.events = (function () {
  var U=CF.util;
  var REGIONS=['north','south','centre'];
  function inRegion(s,i,r){var y=(i/s.W)|0;return r==='north'?y<s.H/2:r==='south'?y>=s.H/2:true;}
  function regionName(r){return r==='north'?'north arc':r==='south'?'south arc':'centre';}
  function materialize(s,p){
    if(!p||p.template!=='beacon_moves')return null;
    var ev=U.deepClone(p), to=ev.affected&&ev.affected[0],t=s.tiles[to];
    if(!t||!t.land||t.capital||to===s.beacon)return null;
    ev.intensity=1;ev.region=ev.region||((to/s.W|0)<s.H/2?'north':'south');ev.affected=[to];
    ev.affectedLabels=[CF.engine.coord(s,to)];return ev;
  }
  function apply(state,p){var ev=materialize(state,p);if(!ev)return{state:state,fx:[],ok:false,event:null};var s=U.deepClone(state),from=s.beacon,to=ev.affected[0];s.beacon=to;s.supply=CF.engine.computeSupply(s);return{state:s,fx:[{kind:'beaconMove',from:from,to:to}],ok:true,at:to,message:'The Beacon moved to '+CF.engine.coord(s,to)+'.',event:ev};}
  function warningFor(ev){return 'The Beacon will move to '+((ev.affectedLabels&&ev.affectedLabels[0])||'the marked tile')+' after scoring.';}
  return {REGIONS:REGIONS,inRegion:inRegion,regionName:regionName,materialize:materialize,apply:apply,warningFor:warningFor,
    isDue:function(ev,turn){return !!ev&&ev.fireTurn<=turn;},nameOf:function(){return'THE BEACON MOVES';},blurbOf:function(){return'The Beacon relights on one exact marked land tile.';},all:function(){return['beacon_moves'];}};
})();
