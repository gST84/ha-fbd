/** The add-on icon (same drawing as docs/icon.svg), inlined so it needs no asset URL behind Ingress. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 256 256" width={size} height={size} role="img" aria-label="FBD Automation" data-testid="logo">
      <defs>
        <linearGradient id="fbd-logo-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1f3a5f" /><stop offset="1" stopColor="#0f1c2e" /></linearGradient>
        <linearGradient id="fbd-logo-blk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#dbe6f3" /></linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill="url(#fbd-logo-bg)" />
      <g fill="none" strokeWidth="10" strokeLinecap="round">
        <path d="M26 98 H78" stroke="#5b7391" />
        <path d="M26 158 H78" stroke="#3ddc84" />
        <path d="M178 128 H230" stroke="#3ddc84" />
      </g>
      <rect x="78" y="62" width="100" height="132" rx="14" fill="url(#fbd-logo-blk)" stroke="#3ddc84" strokeWidth="6" />
      <circle cx="78" cy="98" r="8" fill="#5b7391" /><circle cx="78" cy="158" r="8" fill="#3ddc84" /><circle cx="178" cy="128" r="8" fill="#3ddc84" />
      <text x="128" y="143" textAnchor="middle" fontFamily="DejaVu Sans, Arial, sans-serif" fontWeight="700" fontSize="54" fill="#1f3a5f">≥1</text>
    </svg>
  );
}
