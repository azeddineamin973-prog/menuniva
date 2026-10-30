// XLSX fixture built with the repo's OOXML writer (shared strings). No Excel/LibreOffice is
// installed here (Numbers automation was blocked), so this is NOT an Excel-produced file.
import { writeFileSync } from 'node:fs';
import { buildXlsx } from '../../tests/support/xlsx';
writeFileSync('audit/fixtures/menu.xlsx', buildXlsx([
  ['Categoria', 'Nome', 'Descrição', 'Preço'],
  ['Entradas XLSX', 'Briouats XLSX (audit)', 'Massa folhada recheada', 7.25],
  ['Pratos XLSX', 'Pastilla XLSX (audit)', 'Pastilla de frango', 18.4],
], { sharedStrings: true }));
