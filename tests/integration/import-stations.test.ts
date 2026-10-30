import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { addImportSource, createImportJob, getImportPreview, NO_STATION, publishImport } from '@/server/import/service';
import { changeOrderStatus, stationTickets, submitTableOrder } from '@/server/services/orders';
import { publishChecks } from '@/server/services/publish';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/** Audit GAP-01: imported dishes must reach the right Kitchen/Café display, never silently none. */
describe('import → preparation stations', () => {
  beforeEach(resetDatabase);
  const CSV = 'Categoria;Nome;Preço\nPratos importados;Tajine importado;15,00\nBebidas importadas;Chá importado;2,00\nTest drinks;Sumo importado;3,00\n';

  it('food and drinks imported into new categories are routed to Kitchen and Café and appear on those displays', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job.id, { type: 'CSV', fileName: 'menu.csv' }, new TextEncoder().encode(CSV));
    const p = await getImportPreview(f.ctx, job.id);
    // "Test drinks" already exists with the café as default station → no choice needed
    expect(p.stationTargets.map((t) => t.label)).toEqual(['Pratos importados', 'Bebidas importadas']);
    expect(p.stations.map((s) => s.name).sort()).toEqual(['Test Café', 'Test Kitchen']);
    await publishImport(f.ctx, job.id, { confirm: true, makeVisible: true, stations: { 'Pratos importados': f.kitchen.id, 'Bebidas importadas': f.cafe.id } });

    const ids = Object.fromEntries((await db.menuProduct.findMany({ where: { organizationId: f.org.id, origin: 'IMPORTED' }, include: { translations: true } })).map((x) => [x.translations[0].name, x.id]));
    const r = await submitTableOrder(
      { qrToken: f.qrToken, idempotencyKey: randomUUID(), language: 'pt', items: ['Tajine importado', 'Chá importado', 'Sumo importado'].map((n) => ({ productId: ids[n], quantity: 1, modifiers: [] })) },
      'guest',
    );
    const order = await db.order.findFirstOrThrow({ where: { organizationId: f.org.id, number: r.orderNumber }, include: { items: true } });
    await changeOrderStatus(f.ctx, { orderId: order.id, expectedFrom: 'NEW', to: 'ACCEPTED' });
    const kitchen = await stationTickets(f.ctx, f.kitchen.id);
    const cafe = await stationTickets(f.ctx, f.cafe.id);
    expect(kitchen.tickets.flatMap((t) => t.order.items.map((i) => i.nameSnapshot))).toEqual(['Tajine importado']);
    expect(cafe.tickets.flatMap((t) => t.order.items.map((i) => i.nameSnapshot)).sort()).toEqual(['Chá importado', 'Sumo importado']);
    expect(order.items.every((i) => i.stationId)).toBe(true);
  });

  it('an explicit "no station" choice is allowed, reported after publishing and flagged by the publish checks', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job.id, { type: 'TEXT', text: 'GARRAFAS\nÁgua importada 1,50 €' });
    const res = await publishImport(f.ctx, job.id, { confirm: true, makeVisible: true, stations: { GARRAFAS: NO_STATION } });
    expect(res).toMatchObject({ created: 1, withoutStation: 1 });
    const checks = await publishChecks(f.ctx, f.location.id);
    expect(checks.unrouted.map((u) => u.name)).toEqual(['Água importada']);
  });

  it('existing categories without a station receive the chosen station; a station of another restaurant is refused', async () => {
    const f = await createOrderingFixture();
    const other = await createOrderingFixture('Other');
    const cat = await db.menuCategory.create({ data: { organizationId: f.org.id, menuId: (await db.menu.findFirstOrThrow({ where: { organizationId: f.org.id } })).id, translations: { create: { language: 'pt', name: 'Sobremesas', status: 'SOURCE' } } } });
    const job = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job.id, { type: 'TEXT', text: 'SOBREMESAS\nBaklava 4,00 €' });
    expect((await getImportPreview(f.ctx, job.id)).stationTargets).toEqual([{ label: 'SOBREMESAS', isNew: false }]);
    await expect(publishImport(f.ctx, job.id, { confirm: true, stations: { SOBREMESAS: other.kitchen.id } })).rejects.toThrow(/valid preparation station/);
    await publishImport(f.ctx, job.id, { confirm: true, stations: { SOBREMESAS: f.cafe.id } });
    expect((await db.menuCategory.findUniqueOrThrow({ where: { id: cat.id } })).defaultStationId).toBe(f.cafe.id);
  });
});
