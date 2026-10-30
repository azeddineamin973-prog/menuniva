import { execFileSync } from 'node:child_process';

/** Re-creates the fictitious demo restaurants in the demo database before TEST 20. */
export default function globalSetup() {
  const out = execFileSync('npx', ['tsx', '--conditions=react-server', 'scripts/seed-demo.ts'], {
    env: { ...process.env, DEMO_PASSWORD: 'demo-e2e-password-1', DEMO_JSON: '1' },
    encoding: 'utf8',
  });
  const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{'));
  const d = JSON.parse(line!) as { password: string; tenants: { slug: string; qrToken: string }[] };
  process.env.DEMO_PASSWORD = d.password;
  process.env.DEMO_CASA_QR = d.tenants.find((t) => t.slug === 'casa-de-marrocos-demo')!.qrToken;
}
