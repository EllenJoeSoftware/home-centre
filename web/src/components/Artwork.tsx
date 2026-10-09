import { useState } from "react";
import { urls } from "../api/client";
import type { MediaItem } from "../api/types";
import { hueFor } from "../lib/format";
import { iconForKind } from "./Icons";

interface Props {
  item: Pick<MediaItem, "id" | "kind" | "title" | "hasThumbnail">;
  width?: number;
  className?: string;
  /** Images without a thumbnail fall back to the original file. */
  allowStreamFallback?: boolean;
  eager?: boolean;
}

export function Placeholder({ seed, kind, label }: { seed: string; kind: MediaItem["kind"]; label?: string }) {
  const Icon = iconForKind[kind];
  const h = hueFor(seed);
  return (
    <div
      className="art-placeholder"
      style={{
        background: `radial-gradient(120% 90% at 15% 10%, hsl(${h} 45% 22%) 0%, transparent 60%), linear-gradient(135deg, hsl(${h} 30% 14%), hsl(${(h + 40) % 360} 28% 9%))`,
      }}
    >
      <Icon size={30} />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function Artwork({ item, width = 480, className = "", allowStreamFallback, eager }: Props) {
  const [failed, setFailed] = useState(false);
  let src: string | null = null;
  if (item.hasThumbnail) src = urls.thumbnail(item.id, width);
  else if (item.kind === "image" && allowStreamFallback !== false) src = urls.stream(item.id);

  if (!src || failed) {
    return (
      <div className={`art ${className}`}>
        <Placeholder seed={item.id} kind={item.kind} />
      </div>
    );
  }
  return (
    <div className={`art ${className}`}>
      <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} draggable={false} />
    </div>
  );
}
