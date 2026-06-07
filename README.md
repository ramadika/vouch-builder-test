# Vouch Night-Shift Handover Service

**The problem.** When the night shift ends at 7am, the morning team needs to know
what happened overnight and — more importantly — **what to act on first**. Today
those handovers are assembled by hand and the quality is inconsistent. This
service does it automatically and reliably, for every hotel, every night.

**What it does.** It takes a hotel's structured front-desk events **and** the
free-text, possibly multilingual note a relief staffer left behind, and turns
them into one **action-first briefing** a manager can absorb in 60 seconds — what's
on fire, what's pending, what's just FYI. It tracks each issue across nights (new
tonight vs. still open vs. resolved overnight) and, crucially, **flags anything
contradictory or incomplete instead of smoothing it over** — because it runs
unattended across many hotels, so the manager has to be able to trust it without
double-checking. Every line is traceable back to its source event.

- **Endpoint:** `POST /handover` (HTML by default; JSON with `Accept: application/json`)
- **Health:** `GET /health` → `{ "status": "ok" }`
- **Pipeline:** `normalise (deterministic)` + `parse [Claude]` → `reconcile (deterministic)` → `generate [Claude]` → HTML

See **[DECISIONS.md](DECISIONS.md)** for design rationale and **[CLAUDE.md](CLAUDE.md)**
for architecture, grounding rules, and the file map.

## How it works

| Step | File | Model? |
|---|---|---|
| Normalise structured events | `src/normalise.ts` | no |
| Parse the free-text night log | `src/prompts.ts` → `parseNightLog` | Claude (structured output) |
| Reconcile into issue threads + grounding flags | `src/reconcile.ts` | no |
| Write the grounded handover | `src/prompts.ts` → `generateHandover` | Claude |
| Server, logging, HTML shell | `src/index.ts`, `src/html.ts` | — |

Grounding is enforced by architecture: all cross-night reasoning and
contradiction detection happen in deterministic TypeScript; the model only
extracts from messy text and phrases the final write-up, and every output line
carries its source event IDs.

## Run locally

```bash
npm install
cp .env.example .env        # then set ANTHROPIC_API_KEY
npm run dev                 # tsx watch, listens on PORT (default 3000)
```

`.env` is auto-loaded. Or export the key: `export ANTHROPIC_API_KEY=sk-ant-...`.

```bash
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/
npm start           # run the built server
```

### Verify the deterministic core (no API key needed)

```bash
npx tsx scripts/verify-core.ts
```

Runs normalise + reconcile against the sample data with a fixture standing in for
the parser, and asserts the key grounding flags fire (`STATUS_CONFLICT` on the
312 no-show, `ROOM_STATUS_QUERY` on 205, `INCOMPLETE_ACTION` on damage 226,
`COMPLIANCE_DEADLINE` on the passport backlog, `GUEST_MESSAGE` on the 214
injection).

## Sample curl

HTML, saved and opened in the browser. Save to a **`.html`** file so the browser
renders it (piping into `open -f` writes a `.txt` temp file that shows raw source):

```bash
curl -s -X POST http://localhost:3000/handover \
  -H "Content-Type: application/json" \
  -d '{
    "hotelId": "lumen-sg",
    "shiftDate": "2026-05-30",
    "eventsJson": '"$(cat data/events.json)"',
    "nightLogMd": '"$(cat data/night-logs.md | jq -Rs .)"'
  }' -o handover.html && open handover.html
```

Against the deployed service, swap the URL for
`https://vouch-builder-test-production.up.railway.app/handover`.

JSON (threads + flags + rendered HTML) for a frontend:

```bash
curl -s -X POST http://localhost:3000/handover \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "hotelId": "lumen-sg",
    "shiftDate": "2026-05-30",
    "eventsJson": '"$(cat data/events.json)"',
    "nightLogMd": '"$(cat data/night-logs.md | jq -Rs .)"'
  }' | jq .
```

> The sample data's most recent shift is the night ending **2026-05-30**. If you
> request a `shiftDate` with no events, the service falls back to the latest shift
> present and notes both dates in the logs.

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | `/handover` needs it; `/health` does not |
| `PORT` | no | `3000` | |
| `LOG_LEVEL` | no | `info` | `debug` \| `info` \| `warn` \| `error` |

## Deploy (Railway)

1. Push to GitHub, create a Railway project from the repo.
2. Set `ANTHROPIC_API_KEY` in the Railway dashboard.
3. Railway runs `npm run build` then `npm start`; health check `GET /health`.
4. Run the sample curl against the deployed URL.

## Logging

Structured `pino` JSON at each pipeline step (`events_normalised`,
`parse_output`, `threads_reconciled`, `handover_complete`) with `requestId`,
`hotelId`, `shiftDate`, counts, and `durationMs` — enough to trace any claim in a
handover back to its source event. See the "Debugging" section in `CLAUDE.md`.
