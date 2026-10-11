/** The add-on icon (an OR function block with live wires) for the top bar. Keep in sync with docs/icon.svg. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" data-testid="logo">
      <rect width="256" height="256" rx="56" fill="#1f3a5f" />
      <g fill="none" strokeWidth="14" strokeLinecap="round">
        <path d="M26 98 H78" stroke="#5b7391" />
        <path d="M26 158 H78" stroke="#3ddc84" />
        <path d="M178 128 H230" stroke="#3ddc84" />
      </g>
      <rect x="78" y="62" width="100" height="132" rx="14" fill="#fff" stroke="#3ddc84" strokeWidth="8" />
      <circle cx="78" cy="98" r="9" fill="#5b7391" /><circle cx="78" cy="158" r="9" fill="#3ddc84" /><circle cx="178" cy="128" r="9" fill="#3ddc84" />
      <text x="128" y="143" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="54" fill="#1f3a5f">≥1</text>
    </svg>
  );
}
