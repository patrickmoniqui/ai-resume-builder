"use client";
import { useEffect, useRef, useState } from "react";
const STORAGE = "resume-builder.panel-widths.v1";
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function usePanelWidths(leftOpen: boolean, rightOpen: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState({ left: 272, right: 320 });
  const [width, setWidth] = useState(1440);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || "null");
      if (saved)
        setPreferred({
          left: Number.isFinite(saved.left) ? clamp(saved.left, 200, 480) : 272,
          right: Number.isFinite(saved.right)
            ? clamp(saved.right, 240, 560)
            : 320,
        });
    } catch {
      /* Invalid saved widths use defaults. */
    }
    setReady(true);
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(preferred));
      } catch {
        /* Layout still works when storage is unavailable. */
      }
    }
  }, [preferred, ready]);
  const leftMin = leftOpen ? 200 : 40,
    rightMin = rightOpen ? 240 : 40;
  const leftDesired = leftOpen ? preferred.left : 40,
    rightDesired = rightOpen ? preferred.right : 40;
  const extra = leftDesired - leftMin + rightDesired - rightMin;
  const available = Math.max(0, width - 320 - leftMin - rightMin);
  const ratio = extra ? Math.min(1, available / extra) : 1;
  const left = leftMin + (leftDesired - leftMin) * ratio,
    right = rightMin + (rightDesired - rightMin) * ratio;
  return {
    ref,
    left,
    right,
    leftMax: Math.max(200, Math.min(480, width - right - 320)),
    rightMax: Math.max(240, Math.min(560, width - left - 320)),
    resize: (side: "left" | "right", value: number) =>
      setPreferred((old) => ({
        left:
          side === "left" ? clamp(value, 200, 480) : leftOpen ? left : old.left,
        right:
          side === "right"
            ? clamp(value, 240, 560)
            : rightOpen
              ? right
              : old.right,
      })),
  };
}
export function PanelResizer({
  side,
  width,
  max,
  onResize,
}: {
  side: "left" | "right";
  width: number;
  max: number;
  onResize: (value: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const min = side === "left" ? 200 : 240;
  const resize = (value: number) => onResize(clamp(value, min, max));
  return (
    <div
      className={`panel-resizer ${side}-resizer`}
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${side === "left" ? "templates and jobs" : "right tools"} panel`}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={Math.ceil(max)}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)} pixels`}
      data-resizing={dragging}
      title="Drag to resize · Arrow keys adjust · Double-click to reset"
      style={side === "left" ? { left: width - 4 } : { right: width - 4 }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          resize(
            drag.current.width +
              (event.clientX - drag.current.x) * (side === "left" ? 1 : -1),
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onDoubleClick={() => resize(side === "left" ? 272 : 320)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          resize(
            width +
              (event.key === "ArrowRight" ? 1 : -1) *
                (side === "left" ? 1 : -1) *
                step,
          );
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          resize(event.key === "Home" ? min : max);
        }
      }}
    />
  );
}
