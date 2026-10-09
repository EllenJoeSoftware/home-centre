import { useId } from "react";

export function LogoMark({ size = 32 }: { size?: number }) {
  // Unique gradient id per instance: a hidden copy (e.g. collapsed sidebar) must not own the only def.
  const gid = `hc-g-${useId().replace(/:/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2DD4BF" />
          <stop offset="1" stopColor="#0D9488" />
        </linearGradient>
      </defs>
      <path d="M12 29 32 13l20 16v19a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4Z" fill="none" stroke={`url(#${gid})`} strokeWidth="5" strokeLinejoin="round" />
      <path d="M27.5 31v13l11-6.5Z" fill="#2DD4BF" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-text">
        Home<span>Centre</span>
      </span>
    </span>
  );
}
