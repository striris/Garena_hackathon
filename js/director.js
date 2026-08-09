/* Bounded Beacon director: the model may select one of three fair positions. */
CF.director=(function(){
  var E=CF.engine,EV=CF.events,U=CF.util;
  function distance(s,a,b){return Math.abs(a%s.W-b%s.W)+Math.abs(((a/s.W)|0)-((b/s.W)|0));}
  function candidates(s){
    var opposite=E.laneOf(s,s.beacon)==='NORTH'?'SOUTH':'NORTH', values=[];
    s.tiles.forEach(function(t,i){if(!t.land||t.capital||i===s.beacon)return;var da=distance(s,i,s.capitals[1]),db=distance(s,i,s.capitals[2]);if(Math.abs(da-db)>1)return;var lane=E.laneOf(s,i),score=(lane===opposite?30:0)+(t.owner===0?10:0)-Math.abs(da-5);values.push({at:i,score:score});});
    values.sort(function(a,b){return b.score-a.score||a.at-b.at;});var picked=[];
    values.forEach(function(v){if(picked.length<3&&!picked.some(function(p){return distance(s,p.at,v.at)<2;}))picked.push(v);});
    values.forEach(function(v){if(picked.length<3&&!picked.some(function(p){return p.at===v.at;}))picked.push(v);});
    return picked.map(function(v,n){var ev={id:'C'+(n+1),template:'beacon_moves',intensity:1,region:E.laneOf(s,v.at).toLowerCase(),affected:[v.at],season:s.season+1,fireTurn:s.turn};ev.affectedLabels=[E.coord(s,v.at)];ev.warning=EV.warningFor(ev);return ev;});
  }
  function decorate(s,ev,source){ev=U.deepClone(ev);ev.source=source||'FALLBACK';ev.reasoning='Cinder selected a fair Beacon destination on the opposite arc.';ev.report='Turn '+s.turn+' of '+E.MAX_TURNS+'.';ev.prediction={metric:'beacon_contest',direction:'increase'};ev.goal='move_objective';ev.confidence=.7;return ev;}
  function decide(s){var c=candidates(s);return c.length?decorate(s,c[0],'FALLBACK'):null;}
  function prepare(s){var list=candidates(s),base=list.length?decorate(s,list[0],'FALLBACK'):null;return{report:{season:s.season+1,turn:s.turn},reportText:'Choose the next fair Beacon destination.',candidates:list.map(function(ev){return{id:ev.id,event:ev,summary:'Move Beacon to '+E.coord(s,ev.affected[0])};}),baseline:base,payload:{report:{season:s.season+1,turn:s.turn},candidates:list.map(function(ev){return{id:ev.id,event:{template:ev.template,region:ev.region,affected:ev.affected}};})}};}
  function fromLLM(s,p,d,meta){var id=d&&d.selected_candidate,c=p.candidates.filter(function(x){return x.id===id;})[0];if(!c)return null;var ev=decorate(s,c.event,'LLM');ev.model=meta&&meta.model;ev.latencyMs=meta&&meta.latencyMs||0;ev.requestId=meta&&meta.requestId||null;ev.evidenceUsed=d.evidence_used||[];return ev;}
  return{decide:decide,prepare:prepare,fromLLM:fromLLM,safeDefault:decide,recoverEvent:function(){return null;},scorePrediction:function(s,e){return e;},noteUse:function(){},brief:function(s){return'The Beacon moves every two turns.';},report:function(s){return{turn:s.turn,maxTurns:E.MAX_TURNS};}};
})();
