/**
 * Minimal .xlsx writer with no dependency — the closed network rules out adding
 * a spreadsheet library, and a fill-in template needs very little of one:
 * a stored (uncompressed) zip, inline strings, a frozen header row, and a
 * dropdown sourced from a list on another sheet. Not a general-purpose writer.
 */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface XlsxSheet {
  name: string;
  rows: string[][];
  /** Column widths in Excel character units. */
  widths?: number[];
  /** Row 1 is a header: bold, shaded and frozen. */
  header?: boolean;
  /** Dropdown on one column, sourced from column A of another sheet. Values
   * outside the list stay allowed — it suggests, it does not reject. */
  list?: { col: number; sheet: string; count: number; toRow: number };
}

const te = new TextEncoder();

let crcTable: Uint32Array | null = null;

function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = 0x21; // 1980-01-01 — the file carries no meaningful timestamp

function zip(files: { name: string; data: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = te.encode(f.name);
    const data = te.encode(f.data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);

    parts.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cenSize + end.length);
  let p = 0;
  for (const b of [...parts, ...central, end]) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

const esc = (s: string) =>
  s
    // Control characters are not legal in XML 1.0 and make Excel refuse the file.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

// Style 0 default, 1 header (bold on grey), 2 body (text format, wrapped, top).
// Text format (numFmt 49) keeps values like "0012" or "1-2" from being converted.
const STYLES =
  `${HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function sheetXml(s: XlsxSheet, first: boolean): string {
  const pane = s.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '';
  const view = `<sheetViews><sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>`;
  const cols = s.widths?.length
    ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" style="2" customWidth="1"/>`).join('')}</cols>`
    : '';
  const data = s.rows
    .map((row, r) => {
      const style = s.header && r === 0 ? 1 : 2;
      const cells = row
        .map((v, c) => `<c r="${colName(c)}${r + 1}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  let dv = '';
  if (s.list) {
    const col = colName(s.list.col);
    const src = `'${esc(s.list.sheet).replace(/'/g, "''")}'!$A$1:$A$${s.list.count}`;
    dv =
      `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="0" ` +
      `sqref="${col}${s.header ? 2 : 1}:${col}${s.list.toRow}"><formula1>${src}</formula1></dataValidation></dataValidations>`;
  }
  return `${HEAD}<worksheet ${NS}>${view}${cols}<sheetData>${data}</sheetData>${dv}</worksheet>`;
}

export function writeXlsx(sheets: XlsxSheet[]): Uint8Array {
  const sheetOverrides = sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`)
    .join('');
  const sheetRels = sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('');
  return zip([
    {
      name: '[Content_Types].xml',
      data:
        `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>` +
        `${sheetOverrides}</Types>`,
    },
    {
      name: '_rels/.rels',
      data:
        `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data:
        `${HEAD}<workbook ${NS}><sheets>` +
        sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}` +
        `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s, i === 0) })),
  ]);
}

// ---- reading ---------------------------------------------------------------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('이 브라우저는 xlsx 압축 해제를 지원하지 않습니다 — 표에 복사해 붙여 넣으세요');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Entries of a zip, read through its central directory (sizes there are
 * reliable even when the local headers defer them to a data descriptor). */
async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buf);
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('xlsx 파일이 아닙니다');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const td = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('손상된 xlsx 파일입니다');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    // Other methods never appear in workbooks Excel writes; skip rather than fail.
  }
  return out;
}

const els = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS('*', tag));

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[0-9$]/g, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Text of a string item, rich-text runs included, phonetic hints left out. */
function itemText(si: Element): string {
  return els(si, 't')
    .filter((t) => (t.parentElement?.localName ?? '') !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');
}

/**
 * The first sheet of a workbook as a grid of strings, one array per row with
 * blank rows kept in place. Values come as Excel stored them; numbers are not
 * reformatted, which is right for a sheet of text cells.
 */
export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf);
  const td = new TextDecoder();
  const xml = (path: string) => {
    const b = files.get(path);
    return b ? new DOMParser().parseFromString(td.decode(b), 'application/xml') : null;
  };

  const wb = xml('xl/workbook.xml');
  const first = wb ? els(wb, 'sheet')[0] : undefined;
  if (!first) throw new Error('시트가 없는 xlsx 파일입니다');
  const rid = first.getAttributeNS(REL, 'id') ?? first.getAttribute('r:id');
  const rel = els(xml('xl/_rels/workbook.xml.rels') ?? new Document(), 'Relationship').find(
    (r) => r.getAttribute('Id') === rid,
  );
  const target = rel?.getAttribute('Target') ?? 'worksheets/sheet1.xml';
  const sheet = xml(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  if (!sheet) throw new Error('시트를 읽지 못했습니다');

  const sst = xml('xl/sharedStrings.xml');
  const shared = sst ? els(sst, 'si').map(itemText) : [];

  const grid: string[][] = [];
  let nextRow = 0;
  for (const row of els(sheet, 'row')) {
    const r = Number(row.getAttribute('r')) - 1;
    const ri = Number.isInteger(r) && r >= 0 ? r : nextRow;
    nextRow = ri + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const c of els(row, 'c')) {
      const ref = c.getAttribute('r');
      const ci = ref ? colIndex(ref) : nextCol;
      nextCol = ci + 1;
      const t = c.getAttribute('t');
      const val = els(c, 'v')[0]?.textContent ?? '';
      let s: string;
      if (t === 's') s = shared[Number(val)] ?? '';
      else if (t === 'inlineStr') s = els(c, 'is')[0] ? itemText(els(c, 'is')[0]) : '';
      else if (t === 'b') s = val === '1' ? 'TRUE' : 'FALSE';
      else s = val;
      while (cells.length < ci) cells.push('');
      cells[ci] = s;
    }
    while (grid.length < ri) grid.push([]);
    grid[ri] = cells;
  }
  return grid;
}

export function downloadBytes(filename: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
