import alasql from 'alasql';

let initialized = false;

export function initDatabase() {
  if (initialized) return;
  initialized = true;
}

export function getLoadedTables(): string[] {
  try {
    const tables = alasql('SHOW TABLES');
    return tables.map((t: { tableid: string }) => t.tableid);
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

export function loadCsvData(tableName: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  initDatabase();

  const columns = Object.keys(rows[0]);
  const colDefs = columns.map(c => `[${c.replace(/\s+/g, '_')}] STRING`).join(', ');
  const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '_');

  alasql(`DROP TABLE IF EXISTS [${safeName}]`);
  alasql(`CREATE TABLE [${safeName}] (${colDefs})`);

  const cleanRows = rows.map(row => {
    const clean: Record<string, unknown> = {};
    for (const c of columns) {
      const key = c.replace(/\s+/g, '_');
      const val = row[c];
      if (typeof val === 'string' && val !== '' && !isNaN(Number(val))) {
        clean[key] = Number(val);
      } else {
        clean[key] = val;
      }
    }
    return clean;
  });

  alasql(`INSERT INTO [${safeName}] SELECT * FROM ?`, [cleanRows]);
}
