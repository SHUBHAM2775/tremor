"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, Flame, Activity, Globe, Compass, Cpu, HelpCircle } from "lucide-react";

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
                Tremor measures this conflict using a dynamic <strong>Conflict Score</strong> (a rolling statistical Z-score).
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

        {/* Technical Pipeline Simplified */}
        <section className="space-y-6 border-t border-[var(--border-muted)] pt-8">
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>
              The Technology Under the Hood
            </h3>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-2xl">
              Tremor does not rely on an LLM to decide what is important. It uses statistical machine learning and sentence embedding pipelines to capture structural patterns in real time.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
            <div className="space-y-2 p-4 rounded card border-[var(--border-muted)]">
              <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-bold mb-1">
                <Globe className="w-4 h-4 text-[var(--accent-hi)]" /> Real-time Streaming
              </div>
              <p className="leading-relaxed text-[var(--text-body)]">
                We tap directly into Wikimedia’s live server events. As edits happen anywhere in the world, they stream into our SQLite database within milliseconds.
              </p>
            </div>

            <div className="space-y-2 p-4 rounded card border-[var(--border-muted)]">
              <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-bold mb-1">
                <Compass className="w-4 h-4 text-[var(--accent-hi)]" /> Vector Layout & UMAP
              </div>
              <p className="leading-relaxed text-[var(--text-body)]">
                We convert page summaries into vector embeddings (numbers representing meaning). UMAP reduces this math into 2D coordinates so similar topics sit close to each other on the map.
              </p>
            </div>

            <div className="space-y-2 p-4 rounded card border-[var(--border-muted)]">
              <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-bold mb-1">
                <Cpu className="w-4 h-4 text-[var(--accent-hi)]" /> AI Summary Clerk
              </div>
              <p className="leading-relaxed text-[var(--text-body)]">
                An LLM is used <em>only</em> at the final stage. Instead of guessing who is fighting, it reads the statistical ML logs (edit descriptions, revert ratios) and writes a concise summary explaining the argument.
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
