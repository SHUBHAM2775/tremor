# Prompt for AI coding agent — continuing the Tremor project

Paste this as your instruction to the next AI assistant/agent.

---

I'm building a project called **Tremor** — "a seismograph for Wikipedia." It's a live dashboard that detects which Wikipedia pages are currently in an "edit war" (active conflict) in real time, using real trained ML (not just an LLM API wrapper), with an LLM (Gemini/Groq) used only as a final plain-English explanation layer.

**Full project context is in the attached/pasted file `tremor_project_context.md`** — read it fully before doing anything. It contains the complete scope, the ML breakdown (what's real ML vs just logic), tech stack, week-by-week plan, and folder structure decisions already made. Follow that plan — don't redesign the architecture or suggest a different approach unless something in it is actually broken.

**Current status:** Project skeleton exists. Backend folder structure created, virtual environment set up, `requirements.txt` installed, `.env` configured with `DATABASE_URL=sqlite:///./dev.db`. Two files are already written and confirmed correct:
- `app/models.py` — `Page` and `Revision` SQLAlchemy models
- `app/db.py` — engine, session factory, `init_db()`

**Next file to build:** `app/ingest/stream_listener.py` — connects to Wikipedia's EventStreams API (`https://stream.wikimedia.org/v2/stream/recentchange`), filters for English Wikipedia article edits only, and writes them into the `Revision` table.

**How I want you to work with me — this matters, follow it strictly:**

1. **Give me the full code for one file at a time.** Don't give me multiple files at once.
2. **Immediately after the full code, give a thorough line-by-line breakdown** — what each import is for, what each function does, why specific patterns are used (e.g. why a guard clause, why a particular SQLAlchemy method). Explain it like I'm learning the concept for the first time, because I am.
3. I will read your code and explanation, then **type the file myself** based on what I learned, not copy-paste. This is intentional — I explicitly do not want to just paste your code and move on. I want to actually understand and reproduce it.
4. After I write my version, I'll paste it back to you. **Check it line by line, point out anything wrong or different from your version, and explain why it matters** — don't just say "looks good," actually verify correctness.
5. Once a file is confirmed correct and I've run it successfully, move to the next file in the plan. Don't jump ahead.
6. If I ask a clarifying question (like "why SQLite and not Postgres" or "is uvicorn required"), answer it directly and honestly, including tradeoffs — don't just agree with whatever I suggest. I want honest pushback if my idea has a flaw, not blind agreement.
7. **Don't introduce Docker or CI/CD yet.** Per the plan: Docker gets introduced around the Week 3/4 boundary once the backend has a stable shape. CI/CD gets introduced in Week 6 (deploy/validate/document phase). Don't bring these up earlier even if it seems like a good idea — we already decided the timing deliberately.
8. Stay within the agreed week-by-week plan and Version A scope (anomaly detection + clustering, no manual labeling/classifier yet) unless I explicitly say I want to move to Version B.

**Right now, pick up exactly here:** give me the full code for `app/ingest/stream_listener.py`, followed by the line-by-line explanation, following the rules above.
