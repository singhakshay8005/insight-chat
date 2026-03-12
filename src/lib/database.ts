import alasql from 'alasql';
import { generateSalesData, generateCustomerData } from './sampleData';

let initialized = false;

export function initDatabase() {
  if (initialized) return;

  const sales = generateSalesData();
  const customers = generateCustomerData();

  alasql('CREATE TABLE IF NOT EXISTS sales (date STRING, month STRING, quarter STRING, year INT, region STRING, product_category STRING, product_name STRING, revenue INT, quantity INT, profit INT)');
  alasql('CREATE TABLE IF NOT EXISTS customers (customer_id INT, name STRING, region STRING, signup_date STRING, signup_month STRING)');

  for (const row of sales) {
    alasql('INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      row.date, row.month, row.quarter, row.year, row.region,
      row.product_category, row.product_name, row.revenue, row.quantity, row.profit,
    ]);
  }

  for (const row of customers) {
    alasql('INSERT INTO customers VALUES (?, ?, ?, ?, ?)', [
      row.customer_id, row.name, row.region, row.signup_date, row.signup_month,
    ]);
  }

  initialized = true;
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

  // Batch insert using alasql's SELECT FROM array syntax (much faster)
  const cleanRows = rows.map(row => {
    const clean: Record<string, unknown> = {};
    for (const c of columns) {
      const key = c.replace(/\s+/g, '_');
      const val = row[c];
      // Try to convert numeric strings to numbers for better querying
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
