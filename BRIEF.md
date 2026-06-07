# Vouch Builder Test — Night-Shift Handover

**Time:** ~2 hours of focused work, in one sitting. Note when you start and stop — we trust you.

## Context

Vouch runs front desks for small hotels — including overnight. When our night shift ends at 7am, the morning team needs to know exactly what happened and, more importantly, **what they need to act on first.** Today we assemble these handovers manually and the quality is inconsistent. We want a service that does it automatically and reliably, across many hotels, every night.

This task is a 2-hour slice of that real problem. At Vouch our builders own features end-to-end — imagining, building, testing, deploying, and supporting them — so this test deliberately mixes engineering, AI, and judgment.

## What you're given

In `/data` you'll find a week of real-shape front-desk events for one hotel, **in two formats:**

- `events.json` — structured events, logged by the system on most nights.
- `night-logs.md` — one night was logged as free text by relief staff because the system was down. Relief staff write in whatever language they're comfortable in, so some entries may not be in English.

Both are part of the same handover history. A few things to know:
- A night shift runs roughly 23:00–07:00, so a single shift spans two calendar dates.
- Issues carry across nights — something opened on Monday might still be open on Friday, or get resolved on Thursday.
- The data is messy on purpose, the way real operational data is.

## What to build

A service that generates a **night-shift handover for the morning manager.** Specifically:

1. **Ingest both formats.** Normalize the structured events and the free-text log into one coherent picture.

2. **Reconcile across nights.** The handover for a given morning should distinguish:
   - **Still open** — carried over from previous nights, not yet resolved
   - **Newly resolved** — was open, got handled overnight
   - **New tonight** — happened on the most recent shift

   Don't just re-report every open item from scratch each night. Track the thread.

3. **Generate an action-first handover.** A morning manager reading it should know within 60 seconds what's on fire, what's pending, and what's just FYI. We are **not** looking for a chronological retelling of the night.

4. **Ground every statement in the input.** The handover must not state anything that isn't supported by the data, and must **flag incomplete or contradictory entries** rather than paper over them. This is the part we care about most, because it runs unattended across hundreds of hotels. The bar is grounding, not tool choice — use a model wherever it helps (the input is messy, open-ended, and may not be in English), as long as every statement traces back to the source. Show us how you ensured that.

### Also required

- A backend (Node.js, framework of your choice). Assume input arrives as data, not a file you hand-edit — and assume we may run your service against night-log text you haven't seen, so prefer an approach that generalizes over one hard-coded to this exact sample.
- A way to view the handover — returned HTML, JSON a frontend renders, a Slack/email message — your call.
- Structured logging that another builder (or an AI agent) could use to debug a bad handover in production: *which* hotel, *which* night, *why*.
- Deployed somewhere we can hit with a `curl` command.

## Deliverables

1. **Repo** — GitHub link with full commit history (please don't squash).
2. **Deployed URL** + a sample `curl` command to generate a handover.
3. **`AGENTS.md` / `CLAUDE.md` / Cursor rules** — committed to the repo.
4. **`DECISIONS.md`** covering:
   - What you built and what you deliberately skipped (and why).
   - How you handle reconciliation across nights.
   - How you keep every statement grounded and handle incomplete/contradictory input — and, if you use a model anywhere in the pipeline, how you stop it inventing facts.
   - Where AI helped most, and where it got in the way.
   - What you'd do in hours 3–6 if you had them.
   - One thing that surprised you.
5. **One AI conversation export** — paste or screenshot a session that represents how you actually work (planning, debugging, whatever you're proudest of).

## What we are NOT testing

- **Volume.** 2 hours is short on purpose. We expect sharp tradeoffs.
- **Visual polish.** Utility over beauty.
- **Stack knowledge.** Use AI to fill any gap — that's the job.
- **Whether you "finish."** Most candidates won't fully finish. Honest tradeoffs beat fake completeness.

## A note on how we'll read it

We run this exact workflow in production, so we'll be reading your output the way a real morning manager would. We're less interested in clever code than in whether you made something an operator could trust at 7am — and whether the way you built it would survive contact with hundreds of hotels.

**Submission:** Send everything to [EMAIL]. We'll respond within 5 working days.
