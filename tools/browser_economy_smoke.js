#!/usr/bin/env node
'use strict';

const port = Number(process.argv[2] || 9223);
const appUrl = process.argv[3] || 'http://127.0.0.1:8765/';

async function main() {
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const page = pages.find((entry) => entry.type === 'page');
  if (!page) throw new Error('No debuggable page found');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: appUrl });

    for (let attempt = 0; attempt < 80; attempt++) {
      const ready = await send('Runtime.evaluate', {
        expression: "document.readyState === 'complete' && !!window.CF && !!CF.game && !!CF.render",
        returnByValue: true
      });
      if (ready.result.value) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (attempt === 79) throw new Error('Game did not finish loading');
    }

    const result = await send('Runtime.evaluate', {
      expression: `(async () => {
        const E = CF.engine;
        const R = CF.render;
        const state = CF.game.state;
        document.getElementById('intro-skip').click();
        for (let attempt = 0; attempt < 80 && CF.game.interactionLocked; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (CF.game.interactionLocked) throw new Error('Initial AI doctrine did not unlock');

        const capital = state.tiles.findIndex((tile) => tile.capital === 1);
        state.tiles.forEach((tile) => { if (tile.owner === 1) tile.fert = 0; });
        state.tiles[capital].fert = 8;
        state.tiles[capital].fert -= E.income(state, 1) - 8;
        document.querySelector('[data-tool="expand"]').click();

        let first = -1;
        for (let i = 0; i < state.tiles.length; i++) {
          if (E.canExpand(state, 1, i, []) != null) { first = i; break; }
        }
        if (first < 0) throw new Error('No first expansion target');
        const firstOrder = { type: 'expand', to: first };
        let second = -1;
        for (let i = 0; i < state.tiles.length; i++) {
          if (E.canExpand(state, 1, i, [firstOrder]) === first) { second = i; break; }
        }
        if (second < 0) throw new Error('No chained expansion target');

        function clickTile(index) {
          const tile = R.tileRect(index);
          const canvas = document.getElementById('map');
          const box = canvas.getBoundingClientRect();
          const x = box.left + (tile.x + tile.s / 2) * box.width / canvas.clientWidth;
          const y = box.top + (tile.y + tile.s / 2) * box.height / canvas.clientHeight;
          canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
        }

        clickTile(first);
        clickTile(second);
        const queued = {
          commands: document.getElementById('hud-command-used').textContent.trim(),
          available: document.getElementById('hud-income').textContent.trim(),
          income: document.getElementById('hud-gross').textContent.trim(),
          reserve: document.getElementById('hud-reserve').textContent.trim(),
          spent: document.getElementById('hud-spent').textContent.trim(),
          mobilizationVisible: document.getElementById('orderlist').textContent.toLowerCase().includes('mobilize second command'),
          supportEnabled: !document.getElementById('btn-support').disabled,
          supportLabel: document.getElementById('btn-support').textContent.replace(/\\s+/g, ' ').trim()
        };

        document.getElementById('btn-support').click();
        const supportedSpent = document.getElementById('hud-spent').textContent.trim();
        const statsBefore = state.stats.length;
        document.getElementById('btn-end').click();
        for (let attempt = 0; attempt < 80 && CF.game.state.stats.length === statsBefore; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const finalState = CF.game.state;
        const last = finalState.stats[finalState.stats.length - 1];
        return {
          queued,
          supportedSpent,
          secondStrength: finalState.tiles[second].str,
          supportResolved: last.support[1],
          resolvedSpent: last.spent[1],
          reserveAfter: finalState.reserve[1]
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      throw new Error(detail || result.exceptionDetails.text);
    }
    const value = result.result.value;
    const ok = value.queued.commands === '2' && value.queued.available === '8' &&
      value.queued.income === '8' && value.queued.reserve === '0' &&
      value.queued.spent === '6' && !value.queued.mobilizationVisible &&
      value.queued.supportEnabled && value.queued.supportLabel.includes('CLAIM COMBO') &&
      value.supportedSpent === '8' && value.secondStrength === 2 &&
      value.supportResolved === 'march' && value.resolvedSpent === 8 && value.reserveAfter === 0;
    console.log(JSON.stringify(value, null, 2));
    if (!ok) throw new Error('Browser economy assertions failed');
    console.log('PASS browser economy interaction');
  } finally {
    socket.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
