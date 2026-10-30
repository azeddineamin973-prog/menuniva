import { strToU8, zipSync } from 'fflate';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Builds a real minimal .xlsx (inline strings + numbers) for tests. */
export function buildXlsx(rows: (string | number)[][], opts: { sharedStrings?: boolean } = {}): Uint8Array {
  const shared: string[] = [];
  const cells = rows
    .map((r, ri) => {
      const cs = r
        .map((v, ci) => {
          const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
          if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
          if (opts.sharedStrings) {
            shared.push(v);
            return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cs}</row>`;
    })
    .join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Menu" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet><sheetData>${cells}</sheetData></worksheet>`),
  };
  if (opts.sharedStrings) files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`);
  return zipSync(files);
}
