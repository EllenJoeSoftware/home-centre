import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconChevronLeft, IconChevronRight } from "./Icons";

interface Props {
  title: string;
  eyebrow?: string;
  seeAll?: string;
  children: ReactNode;
  className?: string;
}

/** Moves focus between focusable children with arrow keys (TV-remote friendly). */
export function rovingKeys(e: KeyboardEvent<HTMLElement>, axis: "x" | "grid" = "x") {
  const keys = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  if (!keys.includes(e.key)) return;
  const container = e.currentTarget;
  const items = Array.from(container.querySelectorAll<HTMLElement>(":scope > .card, :scope > * > .card, :scope > .tile"));
  const idx = items.indexOf(document.activeElement as HTMLElement);
  if (idx < 0) return;
  let nextIdx = idx;
  if (e.key === "ArrowRight") nextIdx = idx + 1;
  else if (e.key === "ArrowLeft") nextIdx = idx - 1;
  else {
    // Grid: find the item in the adjacent row closest horizontally.
    const cur = items[idx]!.getBoundingClientRect();
    const down = e.key === "ArrowDown";
    let best = -1;
    let bestScore = Infinity;
    items.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dy = down ? r.top - cur.top : cur.top - r.top;
      if (dy <= 4) return;
      const score = dy * 4 + Math.abs(r.left - cur.left);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) return;
    nextIdx = best;
  }
  const target = items[nextIdx];
  if (!target) return;
  e.preventDefault();
  target.focus();
  target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

export function Row({ title, eyebrow, seeAll, children, className = "" }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: number) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return (
    <section className={`row ${className}`}>
      <header className="row-head">
        <div>
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h2>{title}</h2>
        </div>
        <div className="row-actions">
          {seeAll ? (
            <Link to={seeAll} className="see-all">
              See all
            </Link>
          ) : null}
          <button type="button" className="icon-btn row-arrow" onClick={() => scrollBy(-1)} aria-label={`Scroll ${title} left`} tabIndex={-1}>
            <IconChevronLeft />
          </button>
          <button type="button" className="icon-btn row-arrow" onClick={() => scrollBy(1)} aria-label={`Scroll ${title} right`} tabIndex={-1}>
            <IconChevronRight />
          </button>
        </div>
      </header>
      <div className="row-scroller" ref={scroller} onKeyDown={(e) => rovingKeys(e, "x")}>
        {children}
      </div>
    </section>
  );
}
