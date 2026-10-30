import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// PNG home-screen icon generated from the same artwork as icon.svg.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#171A1D' }}>
        <svg viewBox="0 0 64 64" width="180" height="180">
          <rect x="0" y="0" width="64" height="64" fill="#171A1D" />
          <rect x="13" y="13" width="16" height="16" rx="4" fill="none" stroke="#B9FF36" strokeWidth="3.5" />
          <rect x="18.5" y="18.5" width="5" height="5" rx="1.2" fill="#B9FF36" />
          <rect x="35" y="13" width="5" height="5" rx="1.2" fill="#B9FF36" />
          <rect x="44" y="13" width="7" height="5" rx="1.2" fill="#B9FF36" opacity=".55" />
          <rect x="35" y="22" width="5" height="7" rx="1.2" fill="#B9FF36" opacity=".55" />
          <rect x="13" y="35" width="7" height="5" rx="1.2" fill="#B9FF36" opacity=".55" />
          <rect x="13" y="44" width="5" height="7" rx="1.2" fill="#B9FF36" />
          <path d="M30 47a12 12 0 0 1 24 0z" fill="#B9FF36" />
          <rect x="27" y="48.5" width="30" height="3.5" rx="1.75" fill="#B9FF36" />
          <circle cx="42" cy="32.6" r="2.3" fill="#B9FF36" />
        </svg>
      </div>
    ),
    size,
  );
}
