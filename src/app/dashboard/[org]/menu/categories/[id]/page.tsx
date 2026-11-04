import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { db } from '@/server/db';
import { requireTenantPage } from '@/server/tenant';
import { CategoryEditor } from './category-editor';
import { NO_PREPARATION } from '@/server/services/routing';
import { ScheduleEditor } from '../../schedule-editor';
import { groupSchedules } from '@/lib/schedules';

export default async function CategoryPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const ctx = await requireTenantPage(org, 'menu.edit');
  const [category, stations, o] = await Promise.all([
    db.menuCategory.findFirst({ where: { id, organizationId: ctx.org.id }, include: { translations: true, schedules: true } }),
    db.kitchenStation.findMany({ where: { organizationId: ctx.org.id, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true } }),
  ]);
  if (!category) notFound();
  return (
    <>
      <PageHeader title="Edit category" />
      <CategoryEditor
        org={ctx.org.slug}
        base={`/dashboard/${ctx.org.slug}`}
        id={category.id}
        source={o.sourceLanguage}
        languages={o.enabledLanguages}
        stations={stations.map((s) => ({ id: s.id, name: s.name }))}
        initial={{
          defaultStationId: category.defaultStationId ?? (category.noPreparation ? NO_PREPARATION : null),
          isActive: category.isActive,
          translations: Object.fromEntries(category.translations.map((t) => [t.language, { name: t.name, description: t.description ?? '' }])),
        }}
      />
      <div className="mt-6">
        <ScheduleEditor org={ctx.org.slug} target="category" id={category.id} initial={groupSchedules(category.schedules)} />
      </div>
    </>
  );
}
