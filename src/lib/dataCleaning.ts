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
}

function inferSqlType(values: unknown[]): string {
  const present = values.filter(value => value !== null && value !== undefined && String(value).trim() !== '');
  if (present.length === 0) return 'TEXT';
  if (present.every(value => /^(true|false)$/i.test(String(value).trim()))) return 'BOOLEAN';
  if (present.every(value => String(value).trim() !== '' && Number.isFinite(Number(value)))) return 'NUMBER';
  if (present.every(value => !Number.isNaN(Date.parse(String(value))))) return 'DATETIME';
  return new Set(present.map(value => String(value).trim().toLowerCase())).size <= Math.max(12, present.length * 0.35)
    ? 'CATEGORICAL'
    : 'TEXT';
}

function buildSchema(rows: Record<string, unknown>[]): SchemaColumn[] {
  const columns = Object.keys(rows[0] ?? {});
  return columns.map(name => {
    const values = rows.map(row => row[name]);
    const present = values.filter(value => value !== null && value !== undefined && String(value).trim() !== '');
    const sqlType = inferSqlType(values);
    const numericValues = sqlType === 'NUMBER' ? present.map(Number).filter(Number.isFinite) : [];
    return {
      name,
      sqlType,
      nullCount: values.length - present.length,
      uniqueCount: new Set(present.map(value => String(value))).size,
      min: numericValues.length ? Math.min(...numericValues) : null,
      max: numericValues.length ? Math.max(...numericValues) : null,
      samples: Array.from(new Set(present.map(value => String(value)))).slice(0, 3),
    };
  });
}

function formatSchema(schema: SchemaColumn[]): string {
  return [
    'Uploaded data schema',
    ...schema.map(column => {
      const samples = column.samples.length ? `; samples: ${column.samples.join(', ')}` : '';
      return `- ${column.name} (${column.sqlType}); ${column.nullCount} nulls; ${column.uniqueCount} unique${samples}`;
    }),
  ].join('\n');
}

export async function runPipeline(file: File): Promise<PipelineResult> {
  const parsed = await new Promise<Papa.ParseResult<Record<string, unknown>>>((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: resolve,
      error: reject,
    });
  });

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(firstError?.message || 'The CSV file could not be parsed.');
  }
  if (!parsed.meta.fields?.length || parsed.data.length === 0) {
    throw new Error('This CSV has no rows or column headers.');
  }

  const rawRows = parsed.data;
  const schema = buildSchema(rawRows);
  const report: CleaningReport = {
    rowsBefore: rawRows.length,
    rowsAfter: rawRows.length,
    columnsBefore: schema.length,
    columnsAfter: schema.length,
    renamedColumns: {},
    duplicatesRemoved: 0,
    emptyRowsRemoved: 0,
    columnsDropped: [],
    missingFilled: {},
    typeConversions: {},
    outliersFlagged: {},
    warnings: [],
  };

  return {
    rawRows,
    cleanedRows: rawRows.map(row => ({ ...row })),
    schema,
    schemaText: formatSchema(schema),
    report,
  };
}