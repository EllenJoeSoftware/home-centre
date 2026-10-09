import { Link } from "react-router-dom";
import type { MediaItem } from "../api/types";
import { formatTime, itemSubtitle, progressFraction } from "../lib/format";
import { Artwork } from "./Artwork";
import { IconPlay } from "./Icons";

export type CardShape = "landscape" | "square" | "portrait";

interface Props {
  item: MediaItem;
  shape?: CardShape;
  /** If provided the card is a button (e.g. photos open a lightbox, tracks play). */
  onActivate?: (item: MediaItem) => void;
  to?: string;
  subtitle?: string;
  showRemaining?: boolean;
}

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`progress ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.max(2, value * 100)}%` }} />
    </div>
  );
}

export function MediaCard({ item, shape = "landscape", onActivate, to, subtitle, showRemaining }: Props) {
  const frac = progressFraction(item);
  const remaining = frac != null && item.durationSec ? item.durationSec - (item.progress?.positionSec ?? 0) : null;
  const body = (
    <>
      <div className="card-media">
        <Artwork item={item} width={shape === "landscape" ? 480 : 360} />
        {item.kind !== "image" ? (
          <span className="card-play" aria-hidden="true">
            <IconPlay size={18} />
          </span>
        ) : null}
        {frac != null ? <ProgressBar value={frac} className="card-progress" /> : null}
      </div>
      {item.kind !== "image" || subtitle ? (
        <div className="card-text">
          <div className="card-title" title={item.title}>
            {item.title}
          </div>
          <div className="card-sub">
            {showRemaining && remaining != null ? `${formatTime(remaining)} left` : subtitle ?? itemSubtitle(item)}
          </div>
        </div>
      ) : null}
    </>
  );
  const cls = `card card-${shape} kind-${item.kind}`;
  if (onActivate) {
    return (
      <button type="button" className={cls} onClick={() => onActivate(item)} aria-label={item.title}>
        {body}
      </button>
    );
  }
  return (
    <Link className={cls} to={to ?? `/media/${encodeURIComponent(item.id)}`} aria-label={item.title}>
      {body}
    </Link>
  );
}
