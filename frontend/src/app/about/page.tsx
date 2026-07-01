// NOTE: Whenever a future change meaningfully affects how the system works, the About page's description must be updated to match in the same pass.
"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Flame, Activity, Globe, Compass, Cpu, Layers, Shield, Zap } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="flex flex-col h-screen overflow-y-auto" style={{ background: "var(--bg-base)", color: "var(--text-body)" }}>
      {/* Masthead Header */}
      <header
        className="sticky top-0 z-40 px-5 py-3 flex items-center justify-between"
        style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded flex items-center justify-center shrink-0"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <span
              className="text-base font-bold tracking-tight leading-none"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
            >
              Tremor
            </span>
            <p className="text-[10px] leading-none mt-0.5" style={{ color: "var(--text-subtle)", fontFamily: "var(--font-mono)" }}>
              About & Methodology
            </p>
          </div>
        </div>

        <Link
          href="/"
          className="text-xs px-3 py-1.5 rounded transition-all duration-100 font-semibold flex items-center gap-1.5 cursor-pointer"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-muted)",
            color: "var(--text-body)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-primary)";
            e.currentTarget.style.borderColor = "var(--border)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-body)";
            e.currentTarget.style.borderColor = "var(--border-muted)";
          }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </Link>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10 md:py-16 space-y-12 anim-fade-up">
        {/* Editorial Section Header */}
        <div className="space-y-4 border-b border-[var(--border-muted)] pb-8">
          <span
            className="text-[10px] font-semibold uppercase tracking-widest font-mono text-[var(--accent-hi)]"
            style={{ letterSpacing: "0.15em" }}
          >
            Project Motto & Mission
          </span>
          <h1
            className="text-4xl md:text-5xl font-black text-[var(--text-primary)] leading-tight max-w-2xl"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            A real-time seismograph for the internet’s collective knowledge.
          </h1>
          <p className="text-base md:text-lg leading-relaxed text-[var(--text-body)] font-serif italic max-w-3xl">
            Wikipedia is the playground of human consensus. Tremor listens to its live pulse, detecting where discussions have boiled over into active edit conflicts, and mapping the shape of human disagreement.
          </p>
        </div>

        {/* Analogy & Core Concept Column Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="p-6 rounded card border-[var(--border-muted)] flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-[var(--accent)]" />
                <h3 className="text-lg font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>
                  What is an Edit War?
                </h3>
              </div>
              <p className="text-sm leading-relaxed text-[var(--text-body)]">
                Think of Wikipedia as a giant chalkboard where anyone can write. Usually, writing is cooperative—someone corrects a typo, someone adds a new fact.
              </p>
              <p className="text-sm leading-relaxed text-[var(--text-body)] font-serif italic">
                But sometimes, two people stand at the board with erasers in hand. The moment one person writes, the other immediately wipes it out and restores their own version. This is an <strong>edit war</strong>. It is a sign of deep disagreement over what is considered factual.
              </p>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-subtle)] uppercase">
              Analogies for Non-Tech Users
            </div>
          </div>

          <div className="p-6 rounded card border-[var(--border-muted)] flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-[var(--color-elevated)]" />
                <h3 className="text-lg font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>
                  What is the Conflict Score?
                </h3>
              </div>
              <p className="text-sm leading-relaxed text-[var(--text-body)]">
                Tremor measures this conflict using a dynamic, two-component <strong>Conflict Score</strong> (baseline persistent war level combined with Z-score recency spikes).
              </p>
              <p className="text-sm leading-relaxed text-[var(--text-body)]">
                Just like a seismograph registers background noise vs. tectonic activity:
              </p>
              <ul className="text-xs space-y-2 pl-4 list-disc text-[var(--text-body)]">
                <li><strong>Score 0.0:</strong> Normal background static. A quiet library.</li>
                <li><strong>Score 1.5+:</strong> A visible tremor. Editors are actively disagreeing.</li>
                <li><strong>Score 3.0+:</strong> A major earthquake. Reverts are happening at a blistering pace.</li>
              </ul>
            </div>
            <div className="text-[10px] font-mono text-[var(--text-subtle)] uppercase">
              Tectonic Scale of Consensus
            </div>
          </div>
        </section>

        {/* Severity Metrics Table Section */}
        <section className="space-y-4">
          <h3 className="text-xl font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>
            Understanding the Metric Scales
          </h3>
          <div className="overflow-x-auto rounded border border-[var(--border-muted)]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
                  <th className="p-3 font-mono text-[10px] uppercase font-semibold text-[var(--text-muted)]">Conflict Score</th>
                  <th className="p-3 font-mono text-[10px] uppercase font-semibold text-[var(--text-muted)]">Status</th>
                  <th className="p-3 font-mono text-[10px] uppercase font-semibold text-[var(--text-muted)]">What is Happening</th>
                  <th className="p-3 font-mono text-[10px] uppercase font-semibold text-[var(--text-muted)]">analogy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-muted)] font-normal text-[var(--text-body)]">
                <tr>
                  <td className="p-3 font-mono font-bold text-[var(--color-normal)]">0.0 – 0.5</td>
                  <td className="p-3 font-semibold">Normal / Stable</td>
                  <td className="p-3">Routine updates, grammar corrections, bot formatting.</td>
                  <td className="p-3 italic">A quiet study room.</td>
                </tr>
                <tr>
                  <td className="p-3 font-mono font-bold text-[var(--color-elevated)]">0.5 – 1.5</td>
                  <td className="p-3 font-semibold">Elevated / Active</td>
                  <td className="p-3">Disagreement on terminology, introduction of contested claims.</td>
                  <td className="p-3 italic">A lively classroom debate.</td>
                </tr>
                <tr>
                  <td className="p-3 font-mono font-bold text-[var(--color-critical)]">1.5 – 3.0</td>
                  <td className="p-3 font-semibold">Conflict / Edit War</td>
                  <td className="p-3">Multiple active reverts. Editors undoing each other’s changes within hours.</td>
                  <td className="p-3 italic">Shouting over a whiteboard.</td>
                </tr>
                <tr>
                  <td className="p-3 font-mono font-bold text-[var(--color-critical)] animate-pulse">3.0+</td>
                  <td className="p-3 font-semibold text-[var(--color-critical)]">Critical / Severe</td>
                  <td className="p-3 font-semibold">Rapid-fire reverts, tag-team edit disputes, page protection warnings.</td>
                  <td className="p-3 italic">A chaotic stadium argument.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* How to Use Tremor (Actionable Guide for Non-Tech Users) */}
        <section className="space-y-6 border-t border-[var(--border-muted)] pt-8">
          <div className="space-y-2">
            <span
              className="text-[10px] font-semibold uppercase tracking-widest font-mono text-[var(--accent-hi)]"
              style={{ letterSpacing: "0.15em" }}
            >
              User Interface Walkthrough
            </span>
            <h3 className="text-xl font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>
              How to Navigate the Dashboard
            </h3>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-2xl">
              You don't need a math or engineering degree to use Tremor. Here is a simple, 4-step checklist to help you start scanning consensus:
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded card border-[var(--border-muted)] space-y-2 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-[var(--bg-muted)] flex items-center justify-center text-[10px] font-mono text-[var(--accent-hi)]">1</span>
                  Scan the Live Activity Feed
                </div>
                <p className="leading-relaxed text-[var(--text-body)]">
                  The left panel lists Wikipedia articles in active dispute, sorted by conflict score. A red, pulsing score indicates an active edit war, while green indicates the page is settling back to normal.
                </p>
              </div>
            </div>

            <div className="p-4 rounded card border-[var(--border-muted)] space-y-2 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-[var(--bg-muted)] flex items-center justify-center text-[10px] font-mono text-[var(--accent-hi)]">2</span>
                  Read the AI Dispute Summary
                </div>
                <p className="leading-relaxed text-[var(--text-body)]">
                  Click any page in the feed to open its detail panel in the center. Here, you'll see a **Dispute Summary** written in plain English by AI, explaining *why* editors are arguing without taking sides.
                </p>
              </div>
            </div>

            <div className="p-4 rounded card border-[var(--border-muted)] space-y-2 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-[var(--bg-muted)] flex items-center justify-center text-[10px] font-mono text-[var(--accent-hi)]">3</span>
                  Explore the Radar Map
                </div>
                <p className="leading-relaxed text-[var(--text-body)]">
                  The right panel contains our interactive **Topic Map**. Click on cluster cards to center & zoom into topic groups. Drag to move, scroll to zoom, or search for titles to lock target indicators on specific articles.
                </p>
              </div>
            </div>

            <div className="p-4 rounded card border-[var(--border-muted)] space-y-2 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-[var(--bg-muted)] flex items-center justify-center text-[10px] font-mono text-[var(--accent-hi)]">4</span>
                  Compare Disputes Side-by-Side
                </div>
                <p className="leading-relaxed text-[var(--text-body)]">
                  Want to compare two active wars? Hold <code>Shift</code> and click any node on the Topic Map. A side-by-side comparison screen will slide up from the bottom, comparing their metrics, edits, and active conflict graphs.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Technical Pipeline Simplified */}
        <section className="space-y-6 border-t border-[var(--border-muted)] pt-8">
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>
              The Technology Under the Hood
            </h3>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-2xl">
              Tremor does not rely on simple heuristics to decide what is important. It uses statistical machine learning, vector embedding layouts, and automated queue jobs.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
            <div className="space-y-2 p-4 rounded card border-[var(--border-muted)]">
              <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-bold mb-1">
                <Globe className="w-4 h-4 text-[var(--accent-hi)]" /> Data Fetching Ingestion
              </div>
              <p className="leading-relaxed text-[var(--text-body)]">
                We combine real-time stream listening (Server-Sent Events) with automated, GHA-scheduled polling scripts. Our polling script includes robust rate-limit backoffs and incremental batch checkpoints.
              </p>
            </div>

            <div className="space-y-2 p-4 rounded card border-[var(--border-muted)]">
              <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-bold mb-1">
                <Compass className="w-4 h-4 text-[var(--accent-hi)]" /> Semantic Topic Mapping
              </div>
              <p className="leading-relaxed text-[var(--text-body)]">
                We generate vector embeddings representing article semantic content. <strong>UMAP</strong> reduces these vectors to 2D coordinates for the visual map, while <strong>HDBSCAN</strong> automatically groups them into topical clusters.
              </p>
            </div>

            <div className="space-y-2 p-4 rounded card border-[var(--border-muted)]">
              <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-bold mb-1">
                <Cpu className="w-4 h-4 text-[var(--accent-hi)]" /> Conflict Score Index
              </div>
              <p className="leading-relaxed text-[var(--text-body)]">
                Our model takes the <code>max(base_score, spike_score)</code>: <em>base_score</em> tracks long-term historical revert activity; <em>spike_score</em> calculates a Z-score of recent 24-hour intensity against baseline, boosted by concurrent editor count.
              </p>
            </div>

            <div className="space-y-2 p-4 rounded card border-[var(--border-muted)]">
              <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-bold mb-1">
                <Zap className="w-4 h-4 text-[var(--accent-hi)]" /> Live Stream Firehose Scan
              </div>
              <p className="leading-relaxed text-[var(--text-body)]">
                The stream listener monitors the entire live Wikipedia firehose. To avoid database bloat, untracked edits are aggregated in-memory. High-conflict titles are flagged and pushed to the Redis candidate queue.
              </p>
            </div>

            <div className="space-y-2 p-4 rounded card border-[var(--border-muted)]">
              <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-bold mb-1">
                <Shield className="w-4 h-4 text-[var(--accent-hi)]" /> Capacity & Eviction Rules
              </div>
              <p className="leading-relaxed text-[var(--text-body)]">
                Tracked articles are capped at 8,000 to manage resource constraints. The firehose scanner monitors Wikipedia in real-time, automatically promoting high-conflict pages. If capacity is exceeded, lower-conflict, stale pages are batch-evicted.
              </p>
            </div>

            <div className="space-y-2 p-4 rounded card border-[var(--border-muted)]">
              <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-bold mb-1">
                <Layers className="w-4 h-4 text-[var(--accent-hi)]" /> AI Conflict Analysis
              </div>
              <p className="leading-relaxed text-[var(--text-body)]">
                A Gemini LLM runs on-demand at the final layer. Rather than deciding who is correct, it summarizes the dispute by reading the telemetry log of reverts, comments, and editors.
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center text-[10px] font-mono text-[var(--text-subtle)] border-t border-[var(--border-muted)] pt-8 pb-12">
          Tremor Project · Designed under Swiss Modernism styling principles.
        </footer>
      </main>
    </div>
  );
}
