import { PrintButton } from '@/components/print-button';
import { db } from '@/server/db';
import { qrSvg, tableQrUrl } from '@/server/services/tables';
import { accessibleLocations, requireTenantPage } from '@/server/tenant';

export default async function PrintQrPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'tables.view');
  const [location] = await accessibleLocations(ctx);
  const tables = location
    ? await db.restaurantTable.findMany({
        where: { locationId: location.id, organizationId: ctx.org.id, isActive: true },
        orderBy: [{ area: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
        include: { area: true, qrTokens: { where: { isActive: true }, take: 1 } },
      })
    : [];
  const cards = await Promise.all(tables.filter((t) => t.qrTokens[0]).map(async (t) => ({ t, svg: await qrSvg(tableQrUrl(t.qrTokens[0].token), 220) })));
  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <p className="text-sm text-muted">{cards.length} table cards. Use your browser&apos;s print dialog (A4).</p>
        <PrintButton />
      </div>
      <div className="grid grid-cols-2 gap-4 print:gap-0">
        {cards.map(({ t, svg }) => (
          <div key={t.id} className="flex break-inside-avoid flex-col items-center rounded-2xl border border-line bg-white p-6 text-center text-black print:rounded-none">
            <p className="font-serif text-lg">{ctx.org.name}</p>
            <p className="mt-1 text-2xl font-semibold">Mesa {t.label}</p>
            <div className="my-3 h-[220px] w-[220px]" dangerouslySetInnerHTML={{ __html: svg }} />
            <p className="text-xs text-neutral-600">Digitalize para ver o menu e pedir · Scan to see the menu and order</p>
            {t.area && <p className="mt-1 text-xs text-neutral-500">{t.area.name}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
