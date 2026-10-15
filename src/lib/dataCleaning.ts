import Papa from 'papaparse';

export type ColumnType = 'numeric' | 'datetime' | 'boolean' | 'categorical' | 'text';

export interface SchemaColumn {
  name: string;
  sqlType: string;
  nullCount: number;
  uniqueCount: number;
  min: string | number | null;
  max: string | number | null;
  samples: unknown[];
}

export interface CleaningReport {
  rowsBefore: number;
  rowsAfter: number;
  columnsBefore: number;
  columnsAfter: number;
  renamedColumns: Record<string, string>;
  duplicatesRemoved: number;
  emptyRowsRemoved: number;
  columnsDropped: string[];
  missingFilled: Record<string, { count: number; method: string; value: unknown }>;
  sparseColumns: { name: string; missingPercent: number }[];
  typeConversions: Record<string, string>;
  outliersFlagged: Record<string, { count: number; lowerBound: number; upperBound: number }>;
  warnings: string[];
}

export interface PipelineResult {
  rawRows: Record<string, unknown>[];
  cleanedRows: Record<string, unknown>[];
  schema: SchemaColumn[];
  schemaText: string;
  report: CleaningReport;
  /** cleaned column name -> original raw column name */
  columnSource?: Record<string, string>;
}

type Row = Record<string, unknown>;

/** Hidden key holding the original raw row index (ignored by Object.keys / JSON). */
export const SOURCE_INDEX = Symbol('sourceIndex');

const NULL_TOKENS = new Set(['', 'n/a', 'na', 'null', 'none', 'nan', '-', '--', '?', 'undefined', '#n/a']);
const TRUE_TOKENS = new Set(['true', 'yes', 'y', '1']);
const FALSE_TOKENS = new Set(['false', 'no', 'n', '0']);
const BOOL_TOKENS = new Set(['true', 'false', 'yes', 'no', 'y', 'n']);
const MISSING_SPARSE_THRESHOLD = 0.5;

const SQL_TYPE: Record<ColumnType, string> = {
  numeric: 'NUMBER',
  datetime: 'DATE',
  boolean: 'BOOLEAN',
  categorical: 'CATEGORICAL',
  text: 'TEXT',
};

function isNullish(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return NULL_TOKENS.has(String(value).trim().toLowerCase());
}

/** "Total Sales (Rs)" -> "total_sales_rs" */
function toSnakeCase(name: string): string {
  return (
    name
      .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, '')
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'column'
  );
}

/** "Rs 1,500" / "$2,000.50" / "(300)" / "45%" -> number, or null if not numeric. */
function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value).trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text
    .replace(/^(rs\.?|inr|usd|eur|gbp)\s*/i, '')
    .replace(/\s*(rs\.?|inr|usd|eur|gbp)$/i, '')
    .replace(/[₹$€£¥]/g, '')
    .replace(/%$/, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const pad = (n: number) => String(n).padStart(2, '0');
function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Parses YYYY-MM-DD, DD/MM/YYYY and MM-DD-YYYY. Slash = day-first, dash = month-first,
 * unless the numbers make only one reading possible.
 */
function parseDate(value: unknown): string | null {
  const text = String(value).trim();
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[3];
    const y = +m[4];
    if (a > 12) return validDate(y, b, a);
    if (b > 12) return validDate(y, a, b);
    return m[2] === '-' ? validDate(y, a, b) : validDate(y, b, a);
  }
  if (/[a-z]{3,}/i.test(text) && /\d{4}/.test(text)) {
    const t = Date.parse(text);
    if (!Number.isNaN(t)) {
      const d = new Date(t);
      return validDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
  }
  return null;
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function detectType(values: string[]): ColumnType {
  if (values.length === 0) return 'text';
  const ratio = (fn: (v: string) => boolean) => values.filter(fn).length / values.length;
  if (values.every(v => BOOL_TOKENS.has(v.toLowerCase()))) return 'boolean';
  if (ratio(v => parseNumber(v) !== null) >= 0.9) return 'numeric';
  if (ratio(v => parseDate(v) !== null) >= 0.9) return 'datetime';
  const unique = new Set(values.map(v => v.toLowerCase())).size;
  if (unique <= Math.max(12, values.length * 0.5) && values.every(v => v.length <= 40)) return 'categorical';
  return 'text';
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  values.forEach(v => counts.set(v, (counts.get(v) ?? 0) + 1));
  // Highest count wins; ties broken alphabetically for determinism.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function handleMissingValues(rows: Row[], types: Record<string, ColumnType>) {
  const missingFilled: CleaningReport['missingFilled'] = {};
  const sparseColumns: CleaningReport['sparseColumns'] = [];
  const warnings: string[] = [];

  for (const [column, type] of Object.entries(types)) {
    const missing = rows.filter(row => row[column] === null || row[column] === undefined);
    if (!missing.length) continue;

    const missingRatio = rows.length ? missing.length / rows.length : 0;
    if (missingRatio > MISSING_SPARSE_THRESHOLD) {
      const missingPercent = Math.round(missingRatio * 100);
      sparseColumns.push({ name: column, missingPercent });
      warnings.push(`Sparse column ${column}: ${missingPercent}% missing, kept as is (nulls not filled).`);
      continue;
    }

    if (type === 'numeric') {
      const nums = rows.map(row => row[column]).filter((value): value is number => typeof value === 'number');
      if (!nums.length) continue;
      const value = Math.round(median(nums) * 100) / 100;
      missing.forEach(row => (row[column] = value));
      missingFilled[column] = { count: missing.length, method: 'median', value };
    } else if (type === 'categorical' || type === 'text' || type === 'boolean') {
      const present = rows
        .map(row => row[column])
        .filter(value => value !== null && value !== undefined)
        .map(String);
      const hasMode = present.length > 0;
      const commonValue = hasMode ? mode(present) : 'Unknown';
      const value = type === 'boolean' && hasMode ? commonValue === 'true' : commonValue;
      missing.forEach(row => (row[column] = value));
      missingFilled[column] = {
        count: missing.length,
        method: hasMode ? 'most common' : 'placeholder',
        value,
      };
    }
    // Dates are intentionally left empty so that no trend data is invented.
  }

  return { missingFilled, sparseColumns, warnings };
}

function buildSchema(rows: Row[], columns: string[], types: Record<string, ColumnType>): SchemaColumn[] {
  return columns.map(name => {
    const values = rows.map(r => r[name]);
    const present = values.filter(v => v !== null && v !== undefined && v !== '');
    const type = types[name];
    let min: string | number | null = null;
    let max: string | number | null = null;
    if (type === 'numeric') {
      const nums = present.filter((v): v is number => typeof v === 'number');
      if (nums.length) {
        min = Math.min(...nums);
        max = Math.max(...nums);
      }
    } else if (type === 'datetime') {
      const dates = present.map(String).sort();
      if (dates.length) {
        min = dates[0];
        max = dates[dates.length - 1];
      }
    }
    return {
      name,
      sqlType: SQL_TYPE[type],
      nullCount: values.length - present.length,
      uniqueCount: new Set(present.map(String)).size,
      min,
      max,
      samples: Array.from(new Set(present.map(String))).slice(0, 3),
    };
  });
}

function formatSchema(schema: SchemaColumn[], rowCount: number): string {
  return [
    `Cleaned data schema (${rowCount} rows)`,
    ...schema.map(c => {
      const range = c.min !== null ? `; range ${c.min} to ${c.max}` : '';
      const samples = c.samples.length ? `; samples: ${c.samples.join(', ')}` : '';
      return `- ${c.name} (${c.sqlType}); ${c.nullCount} nulls; ${c.uniqueCount} unique${range}${samples}`;
    }),
  ].join('\n');
}

export async function runPipeline(file: File): Promise<PipelineResult> {
  const parsed = await new Promise<Papa.ParseResult<Row>>((resolve, reject) => {
    Papa.parse<Row>(file, { header: true, skipEmptyLines: false, complete: resolve, error: reject });
  });

  const fatal = parsed.errors.find(e => e.type !== 'FieldMismatch');
  if (fatal) throw new Error(fatal.message || 'The CSV file could not be parsed.');
  const originalColumns = (parsed.meta.fields ?? []).filter(f => f && f.trim());
  if (!originalColumns.length) throw new Error('This CSV has no column headers.');

  const rawRows = parsed.data.filter(r => Object.keys(r).length > 0);
  if (!rawRows.length) throw new Error('This CSV has no rows.');
  const warnings: string[] = [];
  const mismatches = parsed.errors.filter(e => e.type === 'FieldMismatch').length;
  if (mismatches) warnings.push(`${mismatches} row(s) had a different number of values than the header.`);

  // 1. Rename columns to clean, unique snake_case names.
  const renamedColumns: Record<string, string> = {};
  const seen = new Set<string>();
  const colMap: [string, string][] = originalColumns.map(orig => {
    const base = toSnakeCase(orig);
    let name = base;
    let i = 2;
    while (seen.has(name)) name = `${base}_${i++}`;
    seen.add(name);
    if (name !== orig) renamedColumns[orig] = name;
    return [orig, name];
  });

  // 2. Trim text and normalise null tokens.
  let rows: Row[] = rawRows.map((r, index) => {
    const out: Row = {};
    (out as Record<symbol, number>)[SOURCE_INDEX] = index;
    for (const [orig, name] of colMap) {
      const v = r[orig];
      out[name] = isNullish(v) ? null : String(v).trim().replace(/\s+/g, ' ');
    }
    return out;
  });
  let columns = colMap.map(([, n]) => n);

  // 3. Remove empty rows.
  const beforeEmpty = rows.length;
  rows = rows.filter(r => columns.some(c => r[c] !== null));
  const emptyRowsRemoved = beforeEmpty - rows.length;

  // 4. Drop only columns that are 100% empty; sparse columns are retained.
  const columnsDropped: string[] = [];
  columns = columns.filter(c => {
    const nulls = rows.filter(r => r[c] === null).length;
    if (rows.length && nulls === rows.length) {
      columnsDropped.push(c);
      return false;
    }
    return true;
  });
  if (columnsDropped.length) warnings.push(`Dropped mostly-empty column(s): ${columnsDropped.join(', ')}.`);

  // 5. Detect types and convert values.
  const types: Record<string, ColumnType> = {};
  const typeConversions: Record<string, string> = {};
  for (const c of columns) {
    const present = rows.map(r => r[c]).filter((v): v is string => v !== null) as string[];
    const type = detectType(present);
    types[c] = type;
    let failed = 0;
    if (type === 'numeric') {
      rows.forEach(r => {
        if (r[c] === null) return;
        const n = parseNumber(r[c]);
        if (n === null) failed++;
        r[c] = n;
      });
      typeConversions[c] = 'numeric (removed currency symbols, commas)';
    } else if (type === 'datetime') {
      rows.forEach(r => {
        if (r[c] === null) return;
        const d = parseDate(r[c]);
        if (d === null) failed++;
        r[c] = d;
      });
      typeConversions[c] = 'date (standardised to YYYY-MM-DD)';
    } else if (type === 'boolean') {
      rows.forEach(r => {
        if (r[c] === null) return;
        const t = String(r[c]).toLowerCase();
        r[c] = TRUE_TOKENS.has(t) ? true : FALSE_TOKENS.has(t) ? false : null;
      });
      typeConversions[c] = 'boolean (true/false)';
    } else if (type === 'categorical') {
      rows.forEach(r => {
        if (r[c] !== null) r[c] = titleCase(String(r[c]));
      });
      typeConversions[c] = 'category (consistent capitalisation)';
    } else {
      typeConversions[c] = 'text (trimmed)';
    }
    if (failed) warnings.push(`${failed} value(s) in "${c}" could not be read as ${type} and were left empty.`);
  }

  // 6. Remove duplicate rows (after normalisation so "Delhi " == "delhi").
  const beforeDup = rows.length;
  const keys = new Set<string>();
  rows = rows.filter(r => {
    const key = JSON.stringify(columns.map(c => r[c]));
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  const duplicatesRemoved = beforeDup - rows.length;

  // 7. Fill regular missing values and keep sparse columns unchanged.
  const { missingFilled, sparseColumns, warnings: missingWarnings } = handleMissingValues(rows, types);
  warnings.push(...missingWarnings);

  // 8. Flag outliers (IQR rule) without changing the values.
  const outliersFlagged: CleaningReport['outliersFlagged'] = {};
  for (const c of columns) {
    if (types[c] !== 'numeric') continue;
    const nums = rows.map(r => r[c]).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    if (nums.length < 8) continue;
    const q1 = quantile(nums, 0.25);
    const q3 = quantile(nums, 0.75);
    const iqr = q3 - q1;
    const lowerBound = Math.round((q1 - 1.5 * iqr) * 100) / 100;
    const upperBound = Math.round((q3 + 1.5 * iqr) * 100) / 100;
    const count = nums.filter(n => n < lowerBound || n > upperBound).length;
    if (count) outliersFlagged[c] = { count, lowerBound, upperBound };
  }

  const cleanedRows = rows.map(r => {
    const out: Row = {};
    (out as Record<symbol, number>)[SOURCE_INDEX] = (r as Record<symbol, number>)[SOURCE_INDEX];
    columns.forEach(c => (out[c] = r[c]));
    return out;
  });
  const schema = buildSchema(cleanedRows, columns, types);

  return {
    rawRows,
    cleanedRows,
    columnSource: Object.fromEntries(colMap.map(([orig, name]) => [name, orig])),
    schema,
    schemaText: formatSchema(schema, cleanedRows.length),
    report: {
      rowsBefore: rawRows.length,
      rowsAfter: cleanedRows.length,
      columnsBefore: originalColumns.length,
      columnsAfter: columns.length,
      renamedColumns,
      duplicatesRemoved,
      emptyRowsRemoved,
      columnsDropped,
      missingFilled,
      sparseColumns,
      typeConversions,
      outliersFlagged,
      warnings,
    },
  };
}
