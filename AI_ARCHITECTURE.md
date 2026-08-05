# CINDERFALL AI Architecture

## Authority model

CINDERFALL uses two goal-limited AI advisers around a deterministic engine:

```text
resolved public history ──> Saltkin profile ──> Doctrine LLM
                                                │
                                                v
                                      deterministic legal Bot

settled match state ──> candidate enumeration ──> 3-turn rollouts
                                                   │
                                                   v
                                             Director LLM
                                                   │ candidate ID only
                                                   v
                         live validator ──> warning ──> execution
```

The LLMs never receive authority to change a tile, create an event, spend
resources, or waive a guardrail. Saltkin produces a high-level Doctrine. Cinder
selects one ID from a program-generated candidate list. The engine is the only
component that resolves orders and mutates cloned state.

## Service boundary

`server.py` serves the browser and owns three same-origin endpoints:

- `GET /api/ai/health`
- `POST /api/ai/saltkin`
- `POST /api/ai/director`

`ai_service.py` creates the SDK client with:

```python
OpenAI(
    base_url=os.environ["CINDERFALL_AI_BASE_URL"],
    api_key=os.environ["CINDERFALL_API_KEY"],
    timeout=15,
    max_retries=0,
)
```

Both decisions use `client.chat.completions.create()`. The default model is
`openai/gpt-oss-120b`. The complete schema is included in the system message,
then the returned JSON is parsed and checked again by trusted server code. An
unknown candidate, unknown evidence field, extra output property, invalid enum,
timeout, missing key, provider rejection, or malformed JSON becomes an explicit
error and deterministic fallback. The browser learns this timeout from the
health endpoint and adds a 1.5-second response margin, so it does not disconnect
at the same instant as the SDK. The designer failure simulation remains three
seconds for a concise demo.

The browser cannot request `.env`, Python source, Prompt files, Schema files, or
other repository content through the static server allowlist.

## Saltkin privacy and lifecycle

The player profile uses only orders accepted and resolved by the engine. It
contains aggregate ratios and counts, not the current queue, identity, text
input, or personal information. The current order array is local to `main.js`
and is not an argument to `CF.profile.requestPayload()`.

The versioned `localStorage` record retains at most five match summaries. The
designer console includes a clear-memory control.

A Doctrine normally lasts three uses. It cannot be replaced before two uses,
even after a world event, three-tile loss, or Beacon change. Each turn can start
at most one request. Responses are accepted only if `matchId`, `snapshotTurn`,
request sequence, current turn, and pre-order phase still match. Otherwise the
response is discarded and the previous Doctrine or heuristic remains active.

## Director candidates and counterfactuals

Every season, browser-side deterministic code:

1. Enumerates template × intensity × region combinations.
2. Applies all six guardrails.
3. Rejects candidates that reduce either side's available Expand/Raid targets by
   more than 40%.
4. Deduplicates identical resulting maps.
5. Selects at most ten candidates round-robin by template.
6. Runs three pure, deterministic, three-turn rollouts per candidate: continued
   pressure, warning response, and contesting a new prize.

The LLM sees aggregate outcomes—raids, captures, land/income gap, Beacon changes,
cut-off tiles, and remaining choices—and may return only an offered candidate ID.
The original heuristic runs in parallel as a visible shadow baseline.

At execution time the chosen event is checked again against the live board. If
it became unsafe, Cinder tries the next live-safe candidate and finally the
deterministic safe default. An illegal event is never applied.

## Audit data

The UI records normalized decision data only:

- source (`LLM` or `FALLBACK`), model, latency, request ID;
- Doctrine or Director goal and evidence field names;
- candidate counterfactual summaries and shadow baseline;
- guardrail results, player explanation, and prediction score.

It does not request or display private chain-of-thought and never logs API keys.
