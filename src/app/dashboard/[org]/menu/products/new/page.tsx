import { ButtonLink, EmptyState, PageHeader } from '@/components/ui';
import { getMenuAdmin, pickName } from '@/server/services/menu';
import { requireTenantPage } from '@/server/tenant';
import { ProductEditor } from '../product-editor';

export default async function NewProductPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ category?: string }> }) {
  const { org } = await params;
  const { category } = await searchParams;
  const ctx = await requireTenantPage(org, 'menu.edit');
  const { categories, stations, org: o } = await getMenuAdmin(ctx);
  const base = `/dashboard/${ctx.org.slug}`;
  if (categories.length === 0)
    return <EmptyState title="Create a category first" action={<ButtonLink href={`${base}/menu`}>Go to menu</ButtonLink>} />;
  const langs = [o.sourceLanguage, ...o.enabledLanguages];
  return (
    <>
      <PageHeader title="New dish" description="The dish stays a draft (invisible to guests) until you choose “Visible on the menu”." />
      <ProductEditor
        org={ctx.org.slug}
        base={base}
        sourceLanguage={o.sourceLanguage}
        languages={o.enabledLanguages}
        categories={categories.map((c) => ({ id: c.id, name: pickName(c.translations, langs) ?? 'Untitled', defaultStation: c.defaultStation?.name ?? null }))}
        stations={stations.map((s) => ({ id: s.id, name: s.name }))}
        initial={{
          categoryId: categories.find((c) => c.id === category)?.id ?? categories[0].id,
          stationId: null,
          status: 'DRAFT',
          isFeatured: false,
          isPopular: false,
          tags: [],
          translations: {},
          prices: { DINE_IN: '', TAKEAWAY: '', DELIVERY: '' },
        }}
      />
    </>
  );
}
