import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from '@/server/import/adapters';
import { groupDuplicates, similarity } from '@/server/import/dedupe';
import { isPrivateAddress, safeFetch, UnsafeUrlError, validatePublicUrl } from '@/server/import/safe-fetch';
import { parseCsv, rowsToItems } from '@/server/import/tabular';
import { parseMenuText } from '@/server/import/text';
import { readXlsxRows } from '@/server/import/xlsx';
import { buildXlsx } from '../support/xlsx';

describe('M5-03 CSVImporter', () => {
  it('detects ; delimiter, quotes, PT decimal comma and Portuguese headers', () => {
    const csv = '\uFEFFCategoria;Nome;Descrição;Preço\r\nPratos;"Tajine de teste; com ameixas";"Diz ""olá""";16,90\nBebidas;Chá de teste;;2,50\n';
    const r = rowsToItems(parseCsv(csv));
    expect(r.status).toBe('PARSED');
    expect(r.items.map((i) => [i.categoryName, i.name, i.priceCents])).toEqual([
      ['Pratos', 'Tajine de teste; com ameixas', 1690],
      ['Bebidas', 'Chá de teste', 250],
    ]);
    expect(r.items[0].description).toBe('Diz "olá"');
  });

  it('groups size variants and flags unreadable prices instead of guessing', () => {
    const csv = 'category,name,size,price\nDrinks,Test tea,Small,2.50\nDrinks,Test tea,Pot,6.00\nDrinks,Test juice,,abc';
    const r = rowsToItems(parseCsv(csv));
    expect(r.items).toHaveLength(2);
    expect(r.items[0].priceCents).toBe(250);
    expect(r.items[0].variants).toEqual([{ name: 'Small', priceCents: 250 }, { name: 'Pot', priceCents: 600 }]);
    expect(r.items[1].priceCents).toBeUndefined();
    expect(r.items[1].warnings.join()).toMatch(/could not be read/);
  });

  it('fails clearly without a name column and never invents items', () => {
    const r = rowsToItems(parseCsv('foo,bar\n1,2'));
    expect(r.status).toBe('FAILED');
    expect(r.items).toEqual([]);
    expect(r.error).toMatch(/No “name” column/);
  });

  it('reads French, Spanish and Arabic headers', () => {
    expect(rowsToItems(parseCsv('catégorie,nom,prix\nPlats,Test plat,12,00')).items[0].priceCents).toBe(1200);
    expect(rowsToItems(parseCsv('categoría;nombre;precio\nPlatos;Test plato;9,5')).items[0].priceCents).toBe(950);
    expect(rowsToItems(parseCsv('فئة,اسم,السعر\nأطباق,طبق تجريبي,8.00')).items[0].name).toBe('طبق تجريبي');
  });
});

describe('M5-04 ExcelImporter', () => {
  it('reads inline strings, shared strings and numbers from a real .xlsx', async () => {
    for (const sharedStrings of [false, true]) {
      const bytes = buildXlsx([['Category', 'Name', 'Price'], ['Mains', 'Test tagine', 16.9], ['Drinks', 'Test tea', '2,50']], { sharedStrings });
      expect(readXlsxRows(bytes)[1]).toEqual(['Mains', 'Test tagine', '16.9']);
      const r = await ADAPTERS.XLSX.parse({ bytes, fileName: 'menu.xlsx' });
      expect(r.items.map((i) => i.priceCents)).toEqual([1690, 250]);
    }
  });
  it('rejects broken and legacy files with an explanation', async () => {
    expect((await ADAPTERS.XLSX.parse({ bytes: new Uint8Array([1, 2, 3]), fileName: 'x.xlsx' })).status).toBe('FAILED');
    expect((await ADAPTERS.XLSX.parse({ bytes: new Uint8Array([1]), fileName: 'old.xls' })).error).toMatch(/xlsx/);
  });
});

describe('M5-05 TextMenuImporter', () => {
  it('recognises categories, items with prices and descriptions', () => {
    const r = parseMenuText(`PRATOS PRINCIPAIS
Tajine de teste ........ 16,90 €
Com ameixas e amêndoas
Cuscuz de teste - €12
CHÁS
Chá de menta 2.50
Mesa 12
Menu 2024`);
    expect(r.items.map((i) => [i.categoryName, i.name, i.priceCents])).toEqual([
      ['PRATOS PRINCIPAIS', 'Tajine de teste', 1690],
      ['PRATOS PRINCIPAIS', 'Cuscuz de teste', 1200],
      ['CHÁS', 'Chá de menta', 250],
    ]);
    expect(r.items[0].description).toBe('Com ameixas e amêndoas');
  });
  it('fails honestly when no prices are found', () => {
    const r = parseMenuText('Bem-vindo\nObrigado pela visita');
    expect(r.status).toBe('FAILED');
    expect(r.items).toEqual([]);
  });
});

describe('M5-06 PDFMenuImporter / M5-07 ImageMenuImporter', () => {
  it('extracts native text from a digital PDF', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 400]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    ['PRATOS', 'Tajine de teste 16,90 EUR', 'Harira de teste 6,50 EUR'].forEach((t, i) => page.drawText(t, { x: 40, y: 340 - i * 24, size: 14, font }));
    const r = await ADAPTERS.PDF.parse({ bytes: await pdf.save(), fileName: 'menu.pdf' });
    expect(r.extractionMethod).toBe('NATIVE_TEXT');
    expect(r.items.map((i) => [i.name, i.priceCents])).toEqual([
      ['Tajine de teste', 1690],
      ['Harira de teste', 650],
    ]);
  });
  it('reports scanned/no-text PDFs and photos as not extractable (no fake result)', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const r = await ADAPTERS.PDF.parse({ bytes: await pdf.save() });
    expect(r.status).toBe('FAILED');
    expect(r.items).toEqual([]);
    expect(r.error).toMatch(/OCR is not configured/);
    const img = await ADAPTERS.IMAGE.parse({ bytes: new Uint8Array([0xff, 0xd8, 0xff]) });
    expect(img.status).toBe('UNSUPPORTED');
    expect(ADAPTERS.IMAGE.connectionStatus().status).toBe('NOT_CONFIGURED');
    expect((await ADAPTERS.PDF.parse({ bytes: new TextEncoder().encode('not a pdf') })).error).toMatch(/not a PDF/);
  });
});

describe('M5-08/09 Glovo & Uber Eats adapters are honest', () => {
  it('never claims a connection and does not scrape store pages', async () => {
    for (const a of [ADAPTERS.GLOVO, ADAPTERS.UBER_EATS]) expect(a.connectionStatus().status).not.toBe('CONNECTED');
    const g = await ADAPTERS.GLOVO.parse({ url: 'https://glovoapp.com/pt/en/braga/test-restaurant/' });
    expect(g.status).toBe('UNSUPPORTED');
    expect(g.items).toEqual([]);
    expect((await ADAPTERS.GLOVO.parse({ url: 'https://evil.example/glovoapp.com' })).error).toMatch(/expected website/);
    expect((await ADAPTERS.UBER_EATS.parse({ url: 'http://www.ubereats.com/store/x' })).error).toMatch(/https/);
  });
  it('accepts the merchant’s own export', async () => {
    const r = await ADAPTERS.UBER_EATS.parse({ text: 'Category,Item Name,Price\nMains,Tajine de Frango,17.50' });
    expect(r.items[0]).toMatchObject({ name: 'Tajine de Frango', priceCents: 1750 });
  });
});

describe('M5-10 SSRF protection', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])('treats %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  // IPv4 inside IPv6 in every notation, including the hex form URL parsing produces
  // (new URL('https://[::ffff:127.0.0.1]/').hostname is [::ffff:7f00:1]); special IPv6 ranges.
  it.each(['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:0a00:0001', '::7f00:1', '::127.0.0.1', '64:ff9b::a00:1', '64:ff9b::10.0.0.1', '0:0:0:0:0:ffff:7f00:1', '::', '2001:db8::1', '2001::1', '2002:7f00:1::1', 'fec0::1', '100::1', '::ffff:0:7f00:1'])('treats %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it('rejects private IPv4 written as IPv6 in a URL', () => {
    for (const u of ['https://[::ffff:127.0.0.1]/', 'https://[::ffff:169.254.169.254]/latest/meta-data', 'https://[::127.0.0.1]/', 'https://[64:ff9b::10.0.0.1]/']) expect(() => validatePublicUrl(u), u).toThrow(UnsafeUrlError);
  });
  it('treats public addresses as public', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2a00:1450:4003::1')).toBe(false);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateAddress('::ffff:808:808')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });
  it.each(['http://example.com/menu', 'https://127.0.0.1/', 'https://169.254.169.254/latest/meta-data', 'https://localhost/', 'https://user:pw@example.com/', 'https://example.com:8443/', 'file:///etc/passwd', 'not a url'])(
    'rejects %s',
    (u) => {
      expect(() => validatePublicUrl(u)).toThrow(UnsafeUrlError);
    },
  );
  it('blocks hostnames that resolve to private addresses (checked at connect time)', async () => {
    await expect(safeFetch('https://localtest.me/')).rejects.toThrow(); // localtest.me → 127.0.0.1 (or no DNS offline)
  });
});

describe('M5-11 duplicate detection', () => {
  it('matches the same dish across sources, not within one source', () => {
    expect(similarity('Tajine de Frango', 'Tajine de frango ')).toBe(1);
    expect(similarity('Tajine de Frango', 'Tagine de Frango')).toBeGreaterThan(0.85);
    expect(similarity('Tajine de Frango', 'Tajine de Borrego')).toBeLessThan(0.85);
    const groups = groupDuplicates([
      { id: 'g1', name: 'Tajine de Frango', sourceId: 'glovo' },
      { id: 'g2', name: 'Chá de menta', sourceId: 'glovo' },
      { id: 'u1', name: 'Tajine de frango', sourceId: 'uber' },
      { id: 'u2', name: 'Tajine de Frango', sourceId: 'uber' },
    ]);
    expect(groups).toEqual([{ ids: ['g1', 'u1'], confidence: 100 }]);
  });
});
