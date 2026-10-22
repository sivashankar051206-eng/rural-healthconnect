import type { SVGProps } from 'react';

/** Small inline icon set (no icon library => smaller bundle on slow networks). */
const paths: Record<string, string> = {
  doctor: 'M12 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-7 18c0-3.9 3.1-7 7-7s7 3.1 7 7v2H5v-2Zm11-4v2h-2v2h-2v-2h-2v-2h2v-2h2v2h2Z',
  calendar: 'M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3V2Zm12 8H5v10h14V10ZM7 12h4v4H7v-4Z',
  folder: 'M3 5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm5 7h8v2H8v-2Zm0 4h5v2H8v-2Z',
  pill: 'M4.2 12.3 12.3 4.2a5.7 5.7 0 0 1 8 8l-8.1 8.1a5.7 5.7 0 0 1-8-8Zm1.4 1.4a3.7 3.7 0 0 0 5.2 5.2l3.9-3.9-5.2-5.2-3.9 3.9Z',
  clock: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 3v5.4l3.7 2.2-1 1.7L11 13.6V7h2Z',
  help: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1 15v2h2v-2h-2Zm1-12a4 4 0 0 0-4 4h2a2 2 0 1 1 3 1.7c-1.2.7-2 1.6-2 3.3h2c0-.9.4-1.3 1-1.7A4 4 0 0 0 12 5Z',
  mic: 'M12 2a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V5a3 3 0 0 1 3-3Zm-7 9h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h3v2H8v-2h3v-3.1A7 7 0 0 1 5 11Z',
  alert: 'M12 2 1 21h22L12 2Zm-1 7h2v6h-2V9Zm0 8h2v2h-2v-2Z',
  home: 'M12 3 2 11h3v9h5v-6h4v6h5v-9h3L12 3Z',
  user: 'M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-8 18c0-3.3 3.6-6 8-6s8 2.7 8 6v2H4v-2Z',
  back: 'M15.4 4 7.4 12l8 8 1.4-1.4L10.2 12l6.6-6.6L15.4 4Z',
  phone: 'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z',
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 1 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2Z',
  shield: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z',
  chat: 'M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8l-4 4V4a1 1 0 0 1 1-1Z',
  video: 'M3 6a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v3.5l4-2.5v10l-4-2.5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 24, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}
