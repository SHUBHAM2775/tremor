import math
import numpy as np
import pandas as pd
from datetime import datetime, timedelta, timezone
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.db import SessionLocal
from app.models import Page, Revision


# ---------------------------------------------------------------------------
# Two-component conflict scoring
# ---------------------------------------------------------------------------
# Component 1 — BASE SCORE: persistent historical conflict level
#   Derived from the page's entire revision history: revert rate, editor
#   diversity, and total conflict weight.  A page with a long history of
#   reverts keeps a non-zero base score even when currently quiet.
#
# Component 2 — SPIKE SCORE: recency anomaly (Z-score of last 24 h vs baseline)
#   Identical to the Phase 3 Z-score logic; detects sudden bursts of activity
#   that exceed the historical baseline.
#
# Final score = max(base_score, spike_score) + editor-diversity boost
# No artificial ceiling.  Rounded to 2 dp.
# ---------------------------------------------------------------------------


def _compute_base_score(df: pd.DataFrame) -> float:
    """
    Compute a persistent baseline conflict score from the full revision history.

    Uses:
      - revert_rate  : fraction of edits that are reverts (0‥1)
      - editor_entropy : normalised Shannon entropy of editor distribution
      - total_conflict_weight : sum of (revert weight=5, human edit=1, bot=0.1)

    Returns a value in [0, ∞).  Typical contested pages: 0.5‥3.0.
    """
    n = len(df)
    if n < 5:
        return 0.0

    # Human edits only for the diversity calculation
    human = df[df["is_bot"] == 0]

    # Revert rate (from human edits only, to avoid bot-revert noise)
    human_reverts = human["is_revert"].sum()
    human_total = len(human) or 1
    revert_rate = human_reverts / human_total  # 0‥1

    # Editor diversity: normalised entropy over human editors
    if len(human) > 0:
        counts = human["editor"].value_counts(normalize=True)
        entropy = -np.sum(counts * np.log(counts + 1e-9))
        # Max entropy = log(n_unique_editors); normalise to [0,1]
        max_entropy = math.log(max(counts.shape[0], 2))
        norm_entropy = entropy / max_entropy  # 0‥1
    else:
        norm_entropy = 0.0

    # Total conflict weight (sum of per-edit intensity values)
    total_weight = df["intensity"].sum()

    # Combine: revert rate is the most important signal
    base = (
        revert_rate       * 4.0   # 0‥4 ; pure revert-war page ≈ 4
        + norm_entropy    * 1.0   # 0‥1 ; many different editors
        + min(total_weight / 30.0, 1.5)  # 0‥1.5 ; raw volume bonus, capped softly
    )
    return float(base)


def compute_page_anomaly_score(db: Session, page: Page, window_hours: int = 24) -> float:
    """
    Computes a conflict score for a single page using a two-component model:

      base_score  — persistent historical conflict level (non-zero for pages
                    with rich revert history even when currently quiet)
      spike_score — Z-score anomaly of recent 24 h activity vs. baseline
                    (detects sudden bursts above historical mean)

    Final score = max(base_score, spike_score), plus a small boost for
    concurrent active editors + active reverts in the recent window.

    No artificial ceiling is applied.  Result rounded to 2 dp.
    """
    # ── 1. Fetch all revisions (column projection) ────────────────────────────
    revisions = db.query(
        Revision.timestamp, Revision.is_revert, Revision.is_bot, Revision.editor
    ).filter_by(page_id=page.id).all()
    if len(revisions) < 5:
        # Not enough history to establish any meaningful score
        return 0.0

    # ── 2. Build DataFrame ────────────────────────────────────────────────────
    data = []
    for ts, is_revert, is_bot, editor in revisions:
        # Normalise to UTC-naive for consistent pandas operations
        if ts.tzinfo is not None:
            ts = ts.astimezone(timezone.utc).replace(tzinfo=None)
        data.append({
            "timestamp": ts,
            "is_revert": int(is_revert),
            "is_bot":    int(is_bot),
            "editor":    editor or "unknown",
        })

    df = pd.DataFrame(data)
    df.set_index("timestamp", inplace=True)
    df.sort_index(inplace=True)

    # ── 3. Per-edit intensity (revert ×5, bot ×0.1, normal ×1) ───────────────
    df["weight"]    = np.where(df["is_bot"] == 1, 0.1, 1.0)
    df["intensity"] = df["weight"] + (df["is_revert"] * 5.0)

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # ── 4. Component 1 — Base conflict score from full history ────────────────
    base_score = _compute_base_score(df)

    # Force the DataFrame to include the current time to capture trailing silent hours in resample
    df.loc[now] = [0, 0, "system", 0.0, 0.0]

    # ── 5. Hourly time-series for recency spike detection ────────────────────
    hourly = df["intensity"].resample("1h").sum().fillna(0.0)

    # We need at least a few bins to compute a meaningful Z-score.
    # If the entire history is < 3 bins, defer to base_score only.
    if len(hourly) < 3:
        return round(base_score, 2)

    # ── 6. Split: recent window vs. historical baseline ───────────────────────
    cutoff = now - timedelta(hours=window_hours)

    baseline_hourly = hourly[hourly.index < cutoff]
    recent_hourly   = hourly[hourly.index >= cutoff]

    # If almost all edits are within the recent window (brand-new page with
    # a short burst of edits), use the whole series as the baseline.
    if len(baseline_hourly) < 3:
        baseline_hourly = hourly

    mean_baseline = baseline_hourly.mean()
    std_baseline  = baseline_hourly.std()

    # Avoid division by zero or numerical instability on quiet pages; enforce a minimum standard deviation of 1.0
    if pd.isna(std_baseline) or std_baseline < 1.0:
        std_baseline = 1.0

    # Recent mean (0 if no edits in window)
    recent_mean = float(recent_hourly.mean()) if len(recent_hourly) > 0 else 0.0
    if pd.isna(recent_mean):
        recent_mean = 0.0

    # ── 7. Component 2 — Z-score recency spike ───────────────────────────────
    z_score    = (recent_mean - mean_baseline) / std_baseline
    spike_score = max(0.0, float(z_score))

    # ── 8. Final score = max of the two components ───────────────────────────
    score = max(base_score, spike_score)

    # ── 9. Boost for *currently active* conflict indicators ──────────────────
    # Only applies if there is actual activity in the recent window.
    recent_edits = df[df.index >= cutoff]
    if len(recent_edits) > 0:
        unique_editors = recent_edits["editor"].nunique()
        reverts        = int(recent_edits["is_revert"].sum())
        # Extra diversity weight (many concurrent editors = dispute signals)
        if unique_editors > 2:
            score += min(unique_editors * 0.2, 2.0)
        # Extra revert weight
        if reverts > 0:
            score += min(reverts * 0.5, 3.0)

    return round(score, 2)


def update_all_anomaly_scores(db: Session) -> int:
    """
    Computes and updates anomaly scores for all pages in the database.

    Pages with ≥ 5 revisions are scored.
    Pages with < 5 revisions have their score reset to 0.0.

    Returns the number of pages updated.
    """
    # Fast single query: which page IDs have ≥ 5 revisions?
    eligible_ids = [
        r[0] for r in
        db.query(Revision.page_id)
          .group_by(Revision.page_id)
          .having(func.count(Revision.id) >= 5)
          .all()
    ]

    eligible_pages = db.query(Page).filter(Page.id.in_(eligible_ids)).all()

    updated_count = 0
    for page in eligible_pages:
        score = compute_page_anomaly_score(db, page)
        if page.anomaly_score != score or page.last_checked is None:
            page.anomaly_score = score
            page.last_checked  = datetime.now(timezone.utc)
            db.add(page)
            updated_count += 1

    # Reset ineligible pages with stale non-zero scores
    ineligible_pages = db.query(Page).filter(
        (~Page.id.in_(eligible_ids))
        & (Page.anomaly_score != 0.0)
        & (Page.anomaly_score.isnot(None))
    ).all()

    for page in ineligible_pages:
        page.anomaly_score = 0.0
        page.last_checked  = datetime.now(timezone.utc)
        db.add(page)
        updated_count += 1

    db.commit()
    return updated_count


if __name__ == "__main__":
    session = SessionLocal()
    try:
        count = update_all_anomaly_scores(session)
        print(f"Updated anomaly scores for {count} pages.")
        top_pages = session.query(Page).order_by(Page.anomaly_score.desc().nullslast()).limit(10).all()
        print("\n--- TOP CONTESTED PAGES ---")
        for i, p in enumerate(top_pages, 1):
            rev_count = session.query(Revision).filter_by(page_id=p.id).count()
            print(f"{i}. {p.title} | Score: {p.anomaly_score} | Revisions: {rev_count}")
    finally:
        session.close()
