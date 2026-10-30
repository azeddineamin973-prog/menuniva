// Creates Casa de Marrocos as a normal MenuNiva tenant (the first real restaurant).
//
//   npm run setup:casa -- --owner-email=you@example.com
//
// Uses ONLY the real information provided by the owner:
//   name, city, street address, telephone/WhatsApp, cuisine context, service zones, stations.
// It does NOT create dishes, prices, tables, opening hours, photos, delivery fees or a
// Google review link — those are entered by the restaurant in the setup wizard.
// Safe to run more than once (idempotent).
import 'dotenv/config';
import { db } from '../src/server/db';
import { createInvitationRecord } from '../src/server/services/invitations';
import { createRestaurant } from '../src/server/services/organizations';

const SLUG = 'casa-de-marrocos';
const AREAS = ['Sala principal', 'Zona de assentos marroquinos', 'Terraço interior', 'Tenda marroquina (café)'];
const STATIONS = [
  { name: 'Cozinha (piso inferior)', type: 'KITCHEN' as const, sortOrder: 1 },
  { name: 'Café / Chá', type: 'CAFE' as const, sortOrder: 2 },
];

async function main() {
  const ownerEmail = process.argv.find((a) => a.startsWith('--owner-email='))?.split('=')[1]?.trim().toLowerCase();
  if (!ownerEmail) {
    console.error('Usage: npm run setup:casa -- --owner-email=owner@example.com');
    process.exitCode = 1;
    return;
  }
  const existingOrg = await db.restaurantOrganization.findUnique({ where: { slug: SLUG } });
  const owner = await db.user.findUnique({ where: { email: ownerEmail } });

  let orgId: string;
  if (existingOrg) {
    orgId = existingOrg.id;
    console.log('Casa de Marrocos already exists — checking areas and stations only.');
  } else {
    const { org } = await createRestaurant(
      { name: 'Casa de Marrocos', country: 'PT', defaultLanguage: 'pt', locationName: 'Casa de Marrocos — Braga', city: 'Braga' },
      { ownerUserId: owner?.id, actorUserId: owner?.id ?? null },
    );
    orgId = org.id;
    console.log(`Created tenant /${org.slug}`);
  }

  const location = await db.restaurantLocation.findFirstOrThrow({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' } });
  await db.restaurantLocation.update({
    where: { id: location.id },
    data: {
      addressLine1: location.addressLine1 ?? 'Rua de Santa Margarida, 13, 15 e 17',
      city: location.city ?? 'Braga',
      country: 'PT',
      phone: location.phone ?? '+351 935 413 677',
      whatsappNumber: location.whatsappNumber ?? '+351 935 413 677',
      timeZone: 'Europe/Lisbon',
    },
  });
  await db.restaurantBranding.upsert({
    where: { organizationId: orgId },
    update: {},
    create: { organizationId: orgId, themePreset: 'moroccan', primaryColor: '#1F5C4A', accentColor: '#B8975A', backgroundColor: '#FBF7EE', textColor: '#1E2420', headingFont: 'serif' },
  });
  if (!existingOrg) {
    await db.restaurantBranding.update({ where: { organizationId: orgId }, data: { themePreset: 'moroccan', primaryColor: '#1F5C4A', accentColor: '#B8975A', backgroundColor: '#FBF7EE', textColor: '#1E2420', headingFont: 'serif' } });
  }

  for (const [i, name] of AREAS.entries()) {
    const exists = await db.diningArea.findFirst({ where: { locationId: location.id, name } });
    if (!exists) await db.diningArea.create({ data: { organizationId: orgId, locationId: location.id, name, sortOrder: i + 1 } });
  }
  for (const s of STATIONS) {
    const exists = await db.kitchenStation.findFirst({ where: { locationId: location.id, name: s.name } });
    if (!exists) await db.kitchenStation.create({ data: { organizationId: orgId, locationId: location.id, ...s } });
  }

  const membership = owner ? await db.restaurantMembership.findUnique({ where: { userId_organizationId: { userId: owner.id, organizationId: orgId } } }) : null;
  if (owner && !membership) {
    await db.restaurantMembership.create({ data: { userId: owner.id, organizationId: orgId, role: 'RESTAURANT_OWNER' } });
    console.log(`Added ${ownerEmail} as owner.`);
  } else if (!owner) {
    const link = await createInvitationRecord({ organizationId: orgId, email: ownerEmail, role: 'RESTAURANT_OWNER', locationIds: [], invitedById: 'system' });
    console.log(`\nNo account exists yet for ${ownerEmail}. Open this owner invitation link (valid 7 days):\n\n  ${link}\n`);
  } else {
    console.log(`${ownerEmail} is already a member.`);
  }

  console.log('\nStill to be entered by the restaurant in the setup wizard:');
  console.log('  - postal code, opening hours, menu dishes and prices, tables, Google review link, delivery zones');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
