# Archive

These three documents describe the pre-launch product: a searchable public library of
cinematography references, built on a pre-seeded corpus of footage the user did not upload. That
scope has been narrowed. They are kept because their security and pipeline findings still hold and
must not be regressed.

| File | What it is |
|---|---|
| `AI_CODEBASE_AUDIT.md` | Static audit plus runtime proofs — prototype pollution, open redirect, SSRF, RLS and storage privacy. Every finding was fixed; the tests that pin them are in `tests/security.test.ts` and `tests/integration.test.ts`. |
| `SHOTBREAKDOWN_IMPLEMENTATION_PLAN.md` | How the shots model, the durable job queue and hybrid search were built. Still the best description of the pipeline. |
| `SHOTBREAKDOWN_LAUNCH_READINESS.md` | What was verified by running it, against real Supabase, ffmpeg, Anthropic, OpenAI and Stripe. |

**`LAUNCH_PLAN.md` in the repository root is the current scope of record.** Where these documents
disagree with it about what ships, it wins. Where they describe how something works or why a guard
exists, they still stand.
