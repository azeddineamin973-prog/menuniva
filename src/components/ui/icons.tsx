import type { SVGProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * MenuNiva icon set: original 24 × 24 line icons drawn for the dashboard (1.75 px stroke,
 * round caps). Server-component friendly, no icon library.
 */
const PATHS = {
  home: <><path d="M4 11.2 12 4.5l8 6.7" /><path d="M6.5 9.8V19.5h11V9.8" /><path d="M10 19.5v-5h4v5" /></>,
  orders: <><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M9 8.5h6M9 12h6M9 15.5h3.5" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  kitchen: <><path d="M4.5 15.5a7.5 7.5 0 0 1 15 0z" /><path d="M3 18.5h18M12 6v2" /></>,
  tables: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.2" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" /><path d="M14 14h2.5v2.5H14zM18 18h2M18 14v2" /></>,
  bill: <><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" /><path d="M9 8.5h6M9 12h6" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 9.5h16M8.5 3v4M15.5 3v4" /></>,
  book: <><path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z" /><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" /></>,
  import: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 18.5h14" /></>,
  station: <><rect x="3.5" y="5" width="17" height="11" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  tag: <><path d="M3.5 12.4V4.5a1 1 0 0 1 1-1h7.9a1 1 0 0 1 .7.3l7.4 7.4a1 1 0 0 1 0 1.4l-7.9 7.9a1 1 0 0 1-1.4 0l-7.4-7.4a1 1 0 0 1-.3-.7z" /><circle cx="8.3" cy="8.3" r="1.4" /></>,
  bag: <><path d="M5.5 8h13l-1 12h-11z" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>,
  truck: <><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  star: <path d="m12 4 2.4 5 5.4.7-4 3.7 1 5.4L12 16.2l-4.8 2.6 1-5.4-4-3.7 5.4-.7z" />,
  heart: <path d="M12 19.5s-7.5-4.4-7.5-9.7A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6c0 5.3-7.5 9.7-7.5 9.7z" />,
  chart: <><path d="M4 20h16" /><path d="M7 16v-5M12 16V7M17 16v-8" /></>,
  users: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M15.5 5.8a3 3 0 0 1 0 5.4M17.5 19a5.5 5.5 0 0 0-2.5-4.6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6" /></>,
  wand: <><path d="m4 20 10-10M13 5l.8 1.7L15.5 7.5l-1.7.8L13 10l-.8-1.7L10.5 7.5l1.7-.8zM18.5 11l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z" /></>,
  card: <><rect x="3.5" y="6" width="17" height="12.5" rx="2" /><path d="M3.5 10h17M7 15h3" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.8 9.5a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.4v.5M12 16.5v.1" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronUpDown: <path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  more: <><circle cx="5.5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18.5" cy="12" r="1.3" /></>,
  moreVertical: <><circle cx="12" cy="5.5" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="12" cy="18.5" r="1.3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  logout: <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l4-4-4-4M14 12H4" />,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5a7 7 0 0 1 14 0" /></>,
  external: <path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10" />,
  sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></>,
  filter: <path d="M4 5.5h16l-6.2 7.2v5.5l-3.6 1.8v-7.3z" />,
  photo: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5.2-5.2a1 1 0 0 0-1.4 0L6 19" /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4M12 16.8v.1" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.1" /></>,
  checkCircle: <><circle cx="12" cy="12" r="8.5" /><path d="m8.3 12.2 2.5 2.5 5-5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2" /></>,
  print: <><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7.5" rx="2" /><path d="M7 14h10v6H7z" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M4.5 19.5h15" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>,
  edit: <path d="M15.5 4.5 19.5 8.5 9 19H5v-4z" />,
  trash: <><path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M4 4l16 16M9.9 6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.4 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 4-.9" /></>,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" /></>,
  flame: <path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.9-3.3-5.4-4.5-9.7-2.8 1.8-3.4 4.5-3.2 6.4-1.3-.6-2-1.9-2.2-3C6.9 10.5 6 12.6 6 15.2 6 18.6 8.4 21 12 21z" />,
  zap: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  layers: <><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" /></>,
  grip: <><circle cx="9" cy="6" r="1.2" /><circle cx="15" cy="6" r="1.2" /><circle cx="9" cy="12" r="1.2" /><circle cx="15" cy="12" r="1.2" /><circle cx="9" cy="18" r="1.2" /><circle cx="15" cy="18" r="1.2" /></>,
  building: <><path d="M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 15 5v15.5M15 9.5h3.5A1.5 1.5 0 0 1 20 11v9.5M3 20.5h18" /><path d="M8.5 7.5h3M8.5 11h3M8.5 14.5h3" /></>,
  shield: <path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z" />,
  activity: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  inbox: <><path d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" /><path d="M3.5 13.5h5l1 2.5h5l1-2.5h5" /></>,
  sparkles: <path d="M12 3.5 13.6 9 19 10.5l-5.4 1.6L12 17.5l-1.6-5.4L5 10.5 10.4 9zM18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />,
  phone: <path d="M6.5 3.5h3l1.5 4-2 1.2a11 11 0 0 0 6.3 6.3l1.2-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />,
  map: <><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  volume: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  volumeOff: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>,
  maximize: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  smartphone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  tablet: <><rect x="4.5" y="3" width="15" height="18" rx="2.5" /><path d="M10.5 18h3" /></>,
  monitor: <><rect x="3" y="4" width="18" height="12.5" rx="2" /><path d="M9 20.5h6M12 16.5v4" /></>,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6" /></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.5 10.5h6" /></>,
  chat: <><path d="M4.5 18.5 5.6 15A7.5 7.5 0 1 1 9 18.4z" /><path d="M9 10.5h6M9 13.5h3.5" /></>,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, strokeWidth = 1.75, ...props }: { name: IconName; className?: string; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      // `cn` does not merge classes, so the default size is added only when none is given.
      className={cn(!/(^|\s)(size|[a-z-]*:size)-/.test(className ?? '') && 'size-4', 'shrink-0', className)}
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
