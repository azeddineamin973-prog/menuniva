// Real-data UX sandbox only. `casa`: copies the SAVED branding of the casa-de-marrocos tenant
// (read-only from the developer's database) onto the sandbox copy of the restaurant with the
// photos, to preview the Moroccan theme with real dishes. `restore`: puts the sandbox back to that
// restaurant's own saved branding. Never writes to the developer's database.
//   node audit/ux/sandbox-branding.mjs casa|restore
import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;
(async () => {
  const mode = process.argv[2];
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = '/menuniva_ux_real';
  const sb = new Client({ connectionString: u.toString() });
  await sb.connect();
  const org = (await sb.query(`select id from "RestaurantOrganization" where slug='huihugiy'`)).rows[0].id;
  const cols = `"themePreset","primaryColor","accentColor","backgroundColor","textColor"`;
  const pick = async (client, slug) => (await client.query(`select ${cols} from "RestaurantBranding" b join "RestaurantOrganization" o on o.id=b."organizationId" where o.slug=$1`, [slug])).rows[0];
  let b;
  if (mode === 'casa') {
    const dev = new Client({ connectionString: process.env.DATABASE_URL });
    await dev.connect();
    b = await pick(dev, 'casa-de-marrocos');
    await dev.end();
  } else {
    const dev = new Client({ connectionString: process.env.DATABASE_URL });
    await dev.connect();
    b = await pick(dev, 'huihugiy');
    await dev.end();
  }
  await sb.query(`update "RestaurantBranding" set "themePreset"=$1,"primaryColor"=$2,"accentColor"=$3,"backgroundColor"=$4,"textColor"=$5 where "organizationId"=$6`, [b.themePreset, b.primaryColor, b.accentColor, b.backgroundColor, b.textColor, org]);
  console.log(`sandbox branding set (${mode}):`, b);
  await sb.end();
})();
