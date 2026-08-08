# CINDERFALL

**A compact living-map strategy game about choosing a front, protecting a
supply line, and turning a changing battlefield into an opportunity.**

Lead the **Ashfarers** against the rival **Saltkin** on a volcanic island ring.
Each match centres on two clear routes—North and South. Grow a connected line,
pressure the opposing route, and hold the Beacon long enough to win. The world
does not stay still: Cinder can reshape the next opportunity after a turn has
resolved, giving both sides a new decision rather than a hidden advantage.

> 中文概览：CINDERFALL 是一款轻量策略对抗游戏。玩家在北路与南路之间选择
> 本回合的推进方向，通过扩张、固守与进攻保持补给线、争夺 Relay 与 Beacon。
> 火山世界会根据已经结算的战局带来新的地图机会，但对双方保持公开且公平。

## The battlefield

The board is built to be read at a glance.

| Element | Role in the match |
|---|---|
| **North / South routes** | The two main fronts. Commit to one for the turn, then reassess next turn. |
| **Gold / red territory** | Ashfarer and Saltkin control. A deeper fill and bright edge make each connected line easy to read. |
| **Glowing border** | A valid target for the action you currently selected. |
| **◇ Relay** | A supply junction. Taking the complete pair can cut territory beyond it off from its capital. |
| **★ Beacon** | The scoring objective. It matters only while your territory can supply it. |
| **Cinder warning** | An announced world change that both sides can plan around. |

The map is intentionally small: every advance should raise a readable choice.
Do you build a safer line, contest the enemy’s connection, or push the Beacon
while the field is changing?

## How to play

1. **Choose a route and an action.** Follow the highlighted tiles to expand
   from your territory, reinforce a supplied position, or attack an adjacent
   enemy tile.
2. **Keep your line connected.** Land linked back to your capital receives
   Supply. Supply supports your actions and keeps key territory effective.
3. **Use objectives to create pressure.** A Relay can disrupt an enemy route;
   a supplied Beacon turns map control into progress toward victory.
4. **End the turn.** Both sides reveal and resolve their queued orders
   together. Read the battle report, then choose your next front.

The optional **Combo** action becomes available only when your queued actions
form a clear follow-through. It is a reward for building a coherent plan, not
a separate system that must be learned before the first match.

Keyboard controls: `1–4` choose an action, `Enter` ends the turn, and `Esc`
clears the current queue. The first line above the battle log stays fixed as a
short suggestion for the current situation.

For an observation run, use **Auto-select next strategy**. The local field
bot fills the Ashfarers' current queue with a legal plan, while you retain
control of ending the turn. Its proposal disappears after that turn resolves;
the battle report remains available for review.

## A battlefield that responds

Cinderfall is designed around a simple promise: the world can react to play
without taking the match away from the player. Cinder observes only resolved
battlefield patterns—such as pressure on a route or a neglected area—and may
introduce a new resource focus or terrain opportunity for a later turn.

These changes are visible before they take effect. They are there to refresh
the tactical question, not to award a side a win. This makes the changing map
part of the strategy: you can prepare for it, ignore it, or use it to change
the rhythm of a stalemate.

## Run locally

Requirements: **Python 3.9+**. Node.js is optional and is only needed for the
offline simulation command.

```bash
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell: .\.venv\Scripts\Activate.ps1

python -m pip install -r requirements.txt
cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env

python server.py
```

Open <http://127.0.0.1:8000>.

## Optional LLM demo mode

The game remains playable without an API key. During a normal match, Saltkin
and the optional simulated player both use local deterministic field bots. The
Mock button therefore selects the next strategy and fills an immediate legal
test queue without a network request. An OpenAI-compatible model is reserved
for Cinder’s periodic world decisions, where it selects from a concise set of
pre-validated map opportunities.

```dotenv
CINDERFALL_API_KEY=your-key
CINDERFALL_AI_BASE_URL=https://api.siliconflow.cn/v1
CINDERFALL_AI_MODEL=deepseek-ai/DeepSeek-V3
```

Keep this information in `.env`; it is used only by the local server and is
never exposed in the browser.

## Project guide

```text
ai/                 Prompts and response schemas for optional model features
js/                 Game rules, map, events, interface, and presentation
server.py           Local game server and API boundary
tools/simulate.js   Offline match simulation
tests/              Automated checks
```

For local verification:

```bash
node tools/simulate.js 10
python -m unittest discover -s tests -v
```

See [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) and
[THIRD_PARTY.md](THIRD_PARTY.md) for implementation and third-party details.
