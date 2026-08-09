'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'..'),box={console};box.window=box;vm.createContext(box);
['util.js','mapgen.js','engine.js','events.js','validator.js','bot.js','director.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(root,'js',f),'utf8'),box,{filename:f}));
const E=box.CF.engine,D=box.CF.director,EV=box.CF.events;
function adjacentPair(g){for(let i=0;i<g.tiles.length;i++)for(const n of E.neighbors(g,i))if(g.tiles[i].land&&g.tiles[n].land)return[i,n];throw Error('no pair');}
function duel(){const g=E.newGame(7),[a,b]=adjacentPair(g);g.tiles.forEach(t=>{t.owner=0;t.str=0;});g.tiles[a].owner=1;g.tiles[a].str=1;g.tiles[b].owner=2;g.tiles[b].str=1;g.capitals={1:a,2:b};g.tiles[a].capital=1;g.tiles[b].capital=0;g.beacon=a;g.supply=E.computeSupply(g);return{g,a,b};}
{
  const {g,a,b}=duel();const out=E.resolveTurn(g,[{type:'raid',to:b}],[{type:'guard',to:b}]).state;
  assert.equal(out.tiles[b].owner,2,'Guard must cancel one Raid');
}
{
  const {g,b}=duel();const out=E.resolveTurn(g,[{type:'raid',to:b},{type:'raid',to:b}],[{type:'guard',to:b}]).state;
  assert.equal(out.tiles[b].owner,1,'Two Raids must break one Guard');
}
{
  const {g,b}=duel();const out=E.resolveTurn(g,[{type:'raid',to:b}],[]).state;
  assert.equal(out.tiles[b].owner,1,'Raid must flip ownership directly, not create neutral land');
}
{
  const g=E.newGame(11);g.bp[1]=3;g.tiles[g.beacon].owner=1;g.supply=E.computeSupply(g);
  const out=E.resolveTurn(g,[],[]).state;assert.equal(out.over.winner,1);assert.equal(E.MAX_TURNS,10);assert.equal(E.BEACON_TO_WIN,4);
}
{
  const g=E.newGame(13),p=D.prepare(g);assert.equal(p.candidates.length,3);assert.ok(p.candidates.every(c=>c.event.template==='beacon_moves'));
  const moved=EV.apply(g,p.candidates[0].event);assert.ok(moved.ok);assert.notEqual(moved.state.beacon,g.beacon);
}
console.log('v0.2 rules smoke: PASS');
