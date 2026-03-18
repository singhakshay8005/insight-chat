import alasql from 'alasql';

let initialized = false;

export function initDatabase() {
  if (initialized) return;
  initialized = true;
}

export function getLoadedTables(): string[] {
  try {
    const tables = alasql('SHOW TABLES') as { tableid: string }[];
    return tables.map(t => t.tableid);
  } catch {
    return [];
  }
}

export function executeQuery(sql: string): { data: Record<string, unknown>[]; error?: string } {
  try {
    initDatabase();
    const cleanSql = sql.replace(/;$/, '').trim();
    // Only allow SELECT
    if (!/^SELECT/i.test(cleanSql)) {
      return { data: [], error: 'Only SELECT queries are allowed.' };
    }
    const result = alasql(cleanSql);
    return { data: Array.isArray(result) ? result : [] };
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : 'Query execution failed' };
  }
}

export interface ColumnMeta {
  name: string;
  type: 'NUMBER' | 'TEXT';
  sample: unknown[];
}

export function loadCsvData(tableName: string, rows: Record<string, unknown>[]): ColumnMeta[] {
  if (rows.length === 0) return [];
  initDatabase();

  const columns = Object.keys(rows[0]);
  const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '_');

  // Detect column types by scanning first 50 rows
  const columnTypes: Record<string, 'NUMBER' | 'TEXT'> = {};
  for (const c of columns) {
    const key = c.replace(/\s+/g, '_');
    const sampleVals = rows.slice(0, 50).map(r => r[c]).filter(v => v !== '' && v !== null && v !== undefined);
    const numericCount = sampleVals.filter(v => !isNaN(Number(v))).length;
    columnTypes[key] = numericCount > sampleVals.length * 0.7 ? 'NUMBER' : 'TEXT';
  }

  const colDefs = columns.map(c => {
    const key = c.replace(/\s+/g, '_');
    return `[${key}] ${columnTypes[key] === 'NUMBER' ? 'NUMBER' : 'STRING'}`;
  }).join(', ');

  alasql(`DROP TABLE IF EXISTS [${safeName}]`);
  alasql(`CREATE TABLE [${safeName}] (${colDefs})`);

  const cleanRows = rows.map(row => {
    const clean: Record<string, unknown> = {};
    for (const c of columns) {
      const key = c.replace(/\s+/g, '_');
      const val = row[c];
      if (columnTypes[key] === 'NUMBER' && typeof val === 'string' && val !== '' && !isNaN(Number(val))) {
        clean[key] = Number(val);
      } else {
        clean[key] = val;
      }
    }
    return clean;
  });

  alasql(`INSERT INTO [${safeName}] SELECT * FROM ?`, [cleanRows]);

  // Return column metadata with samples
  const sampleRows = rows.slice(0, 5);
  return columns.map(c => {
    const key = c.replace(/\s+/g, '_');
    return {
      name: key,
      type: columnTypes[key],
      sample: sampleRows.map(r => r[c]).filter(v => v !== '' && v !== null),
    };
  });
}
