import { execFileSync } from 'node:child_process';

/** Re-creates the fictitious demo restaurant in the demo database before TEST 20. */
export default function globalSetup() {
  const out = execFileSync('npx', ['tsx', '--conditions=react-server', 'scripts/seed-demo.ts'], {
    env: { ...process.env, DEMO_PASSWORD: 'demo-e2e-password-1', DEMO_JSON: '1' },
    encoding: 'utf8',
  });
  const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{'));
  const d = JSON.parse(line!);
  process.env.DEMO_QR = d.qrToken;
  process.env.DEMO_PASSWORD = d.password;
}
