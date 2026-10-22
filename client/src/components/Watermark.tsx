import { useMemo, type ReactNode } from 'react';

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

/**
 * Dynamic, tiled watermark (patient name, patient ID, date/time, "Confidential Medical
 * Document"). It discourages sharing screenshots; it cannot make copying impossible.
 * Printing, text selection and the context menu are disabled on the protected area.
 */
export function Watermarked({ lines, children }: { lines: string[]; children: ReactNode }) {
  const bg = useMemo(() => {
    const text = lines
      .map((l, i) => `<text x="0" y="${24 + i * 20}" font-size="13" font-family="sans-serif" fill="rgba(160,20,20,0.13)">${escapeXml(l)}</text>`)
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${40 + lines.length * 20}"><g transform="rotate(-24 180 60) translate(10 20)">${text}</g></svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }, [lines]);

  return (
    <div
      className="protected-doc"
      onContextMenu={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {children}
      <div className="watermark" style={{ backgroundImage: bg }} aria-hidden="true" />
    </div>
  );
}
