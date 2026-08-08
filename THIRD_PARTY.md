# Third-party components and disclosure

## Runtime

| Component | Purpose | License / terms |
|---|---|---|
| [OpenAI Python SDK](https://github.com/openai/openai-python) | Server-side OpenAI-compatible Chat Completions client | Apache-2.0 |
| [SiliconFlow](https://siliconflow.cn/) `https://api.siliconflow.cn/v1` | Default OpenAI-compatible inference gateway; configurable through `.env` | Subject to the gateway operator's terms and privacy policy |
| `moonshotai/Kimi-K2.7-Code` | Default Saltkin Doctrine, Cinder candidate selection, and Mock Player model; configurable through `.env` | Model access and usage are supplied by the configured gateway |
| Python standard library HTTP server | Local static/API prototype server | Python Software Foundation License |
| Browser Canvas and `localStorage` | Rendering and five-match, non-identifying adaptation memory | Browser platform APIs |
| Node.js | Offline simulation and invariant tests only | Node.js license |

There are no external datasets, analytics SDKs, accounts, advertising systems,
or production tracking services in this prototype.

## Credentials and data

The repository contains no API key. `CINDERFALL_API_KEY` is read only by the
Python process from the environment or ignored `.env` file. It is never sent to
the browser, returned by health endpoints, or written to application logs.

Requests to the configured inference gateway contain aggregate game state,
pre-validated Director candidate summaries, or a non-identifying player profile.
They do not contain the player's current unsubmitted orders or personal data.
