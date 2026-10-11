import type { ReactNode } from 'react';

/** Small glyphs (16 × 16 grid) for what a SET / RESET / TOGGLE block switches. */
const GLYPHS: Record<string, { label: string; shape: ReactNode }> = {
  light: { label: 'Lights', shape: <path d="M8 1.5a4.6 4.6 0 0 0-2.6 8.4v1.6h5.2V9.9A4.6 4.6 0 0 0 8 1.5zM5.9 12.6h4.2v1.9H5.9z" /> },
  media_player: { label: 'Media players', shape: <path d="M5.6 3.2 13.4 1.5v9.3a2.3 2.3 0 1 1-1.4-2.1V4.7L7 5.8v6.6a2.3 2.3 0 1 1-1.4-2.1z" /> },
  switch: { label: 'Switches', shape: <path fillRule="evenodd" d="M5 4.2h6a3.8 3.8 0 0 1 0 7.6H5a3.8 3.8 0 0 1 0-7.6zM11 5.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z" /> },
  fan: { label: 'Fans', shape: <>{[0, 120, 240].map(a => <ellipse key={a} cx={8} cy={4.3} rx={2.1} ry={3.1} transform={`rotate(${a} 8 8)`} />)}<circle cx={8} cy={8} r={1.5} /></> },
  climate: { label: 'Climate', shape: <path fillRule="evenodd" d="M8 1.3a2.1 2.1 0 0 0-2.1 2.1v5.3a3.6 3.6 0 1 0 4.2 0V3.4A2.1 2.1 0 0 0 8 1.3zM7.3 3.4a.7.7 0 0 1 1.4 0v6l.4.3a2.2 2.2 0 1 1-2.2 0l.4-.3z" /> },
};

export const hasDomainIcon = (domain: string) => domain in GLYPHS;

export function DomainIcon({ domain, x, y, size = 14 }: { domain: string; x: number; y: number; size?: number }) {
  const g = GLYPHS[domain];
  if (!g) return null;
  return (
    <svg className="domain-icon" data-domain={domain} x={x} y={y} width={size} height={size} viewBox="0 0 16 16">
      <title>{g.label}</title>
      {g.shape}
    </svg>
  );
}
