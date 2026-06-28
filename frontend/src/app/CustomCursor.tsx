"use client";

import { useEffect, useRef } from "react";

export default function CustomCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. Skip rendering and cursor hijacking on touch devices
    const isTouch =
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches ||
        "ontouchstart" in window ||
        navigator.maxTouchPoints > 0);

    if (isTouch) {
      return;
    }

    const cursor = cursorRef.current;
    if (!cursor) return;

    // Set cursor visibility and global HTML class to hide the standard OS pointer
    cursor.classList.add("visible");
    document.documentElement.classList.add("custom-cursor-active");

    const onMouseMove = (e: MouseEvent) => {
      // Direct DOM style translation for top-tier rendering performance
      // For pointer arrow silhouette, the hotspot is at (0,0), so no offset is needed.
      cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Classify clickable/interactive elements
      const isInteractive =
        target.closest('a, button, select, [role="button"], input[type="submit"], input[type="button"], .cursor-pointer') ||
        target.classList.contains("cursor-pointer");

      // Check text input elements (search bars, filter inputs)
      const isInput =
        target.closest('input[type="text"], input[type="search"], textarea, [contenteditable]') ||
        (target.tagName === "INPUT" && 
          (target as HTMLInputElement).type !== "submit" && 
          (target as HTMLInputElement).type !== "button") ||
        target.tagName === "TEXTAREA";

      if (isInput) {
        cursor.classList.add("cursor-text");
        cursor.classList.remove("cursor-hover");
      } else if (isInteractive) {
        cursor.classList.add("cursor-hover");
        cursor.classList.remove("cursor-text");
      } else {
        cursor.classList.remove("cursor-hover", "cursor-text");
      }
    };

    const onMouseDown = () => {
      cursor.classList.add("cursor-active");
    };

    const onMouseUp = () => {
      cursor.classList.remove("cursor-active");
    };

    const onMouseLeave = () => {
      cursor.classList.remove("visible");
    };

    const onMouseEnter = () => {
      cursor.classList.add("visible");
    };

    // Passive listeners prevent scroll lag and event queuing overhead
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mouseover", onMouseOver, { passive: true });
    window.addEventListener("mousedown", onMouseDown, { passive: true });
    window.addEventListener("mouseup", onMouseUp, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave, { passive: true });
    document.addEventListener("mouseenter", onMouseEnter, { passive: true });

    return () => {
      document.documentElement.classList.remove("custom-cursor-active");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseover", onMouseOver);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("mouseenter", onMouseEnter);
    };
  }, []);

  return (
    <div ref={cursorRef} className="seismograph-cursor">
      {/* Subtle hover background glow centered around the tip hotspot */}
      <div className="cursor-glow" />
      
      {/* Standard Pointer Arrow SVG Geometry */}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ overflow: "visible" }}
      >
        <path
          className="cursor-arrow-path"
          d="M 0 0 L 0 17 L 4.75 12.25 L 9.5 22 L 12.5 20.5 L 7.75 10.75 L 14 10.75 Z"
          fill="var(--accent)"
          stroke="#09090b"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
