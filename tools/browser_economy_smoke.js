#!/usr/bin/env node
'use strict';

// Browser-level check for the Lite token economy: actions are free, exactly
// two commands are sealed, and each queued boost consumes at most one token.
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

    const evaluated = await send('Runtime.evaluate', {
      expression: `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.getElementById('intro-skip').click();
        for (let i = 0; i < 100 && CF.game.interactionLocked; i++) await sleep(100);
        if (CF.game.interactionLocked) throw new Error('Initial strategy card did not unlock');

        const E = CF.engine;
        const R = CF.render;
        const state = CF.game.state;
        state.tokens[1] = 2;
        document.querySelector('[data-tool="expand"]').click();

        let first = -1;
        for (let i = 0; i < state.tiles.length; i++) {
          if (E.canExpand(state, 1, i, []) != null) { first = i; break; }
        }
        if (first < 0) throw new Error('No first expansion target');
        const firstOrder = { type: 'expand', to: first, boosted: true };
        let second = -1;
        for (let i = 0; i < state.tiles.length; i++) {
          if (E.canExpand(state, 1, i, [firstOrder]) === first) { second = i; break; }
        }
        if (second < 0) throw new Error('No chained expansion target');

        function clickTile(index) {
          const tile = R.tileRect(index);
          const canvas = document.getElementById('map');
          const box = canvas.getBoundingClientRect();
          canvas.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            clientX: box.left + (tile.x + tile.s / 2) * box.width / canvas.clientWidth,
            clientY: box.top + (tile.y + tile.s / 2) * box.height / canvas.clientHeight
          }));
        }

        document.getElementById('btn-boost').click();
        clickTile(first);
        document.getElementById('btn-boost').click();
        clickTile(second);
        const queued = {
          commands: document.getElementById('hud-command-used').textContent.trim(),
          tokensLeft: document.getElementById('hud-tokens').textContent.trim(),
          boostedRows: document.querySelectorAll('#orderlist li.boosted').length,
          endEnabled: !document.getElementById('btn-end').disabled,
          freeLabels: Array.from(document.querySelectorAll('.tool .tcost')).every((node) => node.textContent.trim() === 'FREE'),
          legacyEconomyAbsent: !document.getElementById('btn-support') && !document.getElementById('hud-reserve')
        };

        document.querySelector('#orderlist .order-boost').click();
        const tokenReturned = document.getElementById('hud-tokens').textContent.trim();
        document.querySelector('#orderlist .order-boost').click();
        const statsBefore = state.stats.length;
        document.getElementById('btn-end').click();
        for (let i = 0; i < 100 && CF.game.state.stats.length === statsBefore; i++) await sleep(60);
        const finalState = CF.game.state;
        const stat = finalState.stats[finalState.stats.length - 1];
        return {
          queued,
          tokenReturned,
          firstStrength: finalState.tiles[first].str,
          secondStrength: finalState.tiles[second].str,
          tokensSpent: stat.tokensSpent[1],
          acceptedCommands: stat.fieldCommands[1]
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (evaluated.exceptionDetails) {
      const detail = evaluated.exceptionDetails.exception && evaluated.exceptionDetails.exception.description;
      throw new Error(detail || evaluated.exceptionDetails.text);
    }
    const value = evaluated.result.value;
    const ok = value.queued.commands === '2' && value.queued.tokensLeft === '0' &&
      value.queued.boostedRows === 2 && value.queued.endEnabled && value.queued.freeLabels &&
      value.queued.legacyEconomyAbsent && value.tokenReturned === '1' &&
      value.firstStrength === 2 && value.secondStrength === 2 &&
      value.tokensSpent === 2 && value.acceptedCommands === 2;
    console.log(JSON.stringify(value, null, 2));
    if (!ok) throw new Error('Browser Lite token assertions failed');
    console.log('PASS browser Lite token interaction');
  } finally {
    socket.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
