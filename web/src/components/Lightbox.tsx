import { useCallback, useEffect, useRef, useState } from "react";
import { urls } from "../api/client";
import type { MediaItem } from "../api/types";
import { formatDate } from "../lib/format";
import { IconChevronLeft, IconChevronRight, IconClose } from "./Icons";

interface Props {
  items: MediaItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

export function Lightbox({ items, index, onIndex, onClose }: Props) {
  const item = items[index];
  const [dragX, setDragX] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<Element | null>(null);

  const go = useCallback(
    (d: number) => {
      const n = index + d;
      if (n >= 0 && n < items.length) onIndex(n);
    },
    [index, items.length, onIndex],
  );

  useEffect(() => {
    prevFocus.current = document.activeElement;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      (prevFocus.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // Preload neighbours.
  useEffect(() => {
    [items[index - 1], items[index + 1]].forEach((it) => {
      if (it) {
        const img = new Image();
        img.src = urls.stream(it.id);
      }
    });
  }, [index, items]);

  if (!item) return null;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={item.title}>
      <div className="lightbox-top">
        <div className="lightbox-caption">
          <strong>{item.title}</strong>
          <span>
            {index + 1} / {items.length}
            {item.width && item.height ? ` · ${item.width}×${item.height}` : ""} · {formatDate(item.modifiedAt)}
          </span>
        </div>
        <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>
      <div
        className="lightbox-stage"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          if (start.current && start.current.id === e.pointerId) setDragX(e.clientX - start.current.x);
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          setDragX(0);
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
          else if (dy > 120) onClose();
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragX(0);
        }}
      >
        <img
          key={item.id}
          src={urls.stream(item.id)}
          alt={item.title}
          draggable={false}
          style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }}
        />
      </div>
      <button type="button" className="lightbox-nav prev" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous photo">
        <IconChevronLeft size={28} />
      </button>
      <button type="button" className="lightbox-nav next" onClick={() => go(1)} disabled={index >= items.length - 1} aria-label="Next photo">
        <IconChevronRight size={28} />
      </button>
    </div>
  );
}
