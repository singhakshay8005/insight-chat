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
  const colDefs = columns.map(c => `${c.replace(/\s+/g, '_')} STRING`).join(', ');

  alasql(`DROP TABLE IF EXISTS ${tableName}`);
  alasql(`CREATE TABLE ${tableName} (${colDefs})`);

  for (const row of rows) {
    const vals = columns.map(c => row[c]);
    const placeholders = columns.map(() => '?').join(', ');
    alasql(`INSERT INTO ${tableName} VALUES (${placeholders})`, vals);
  }
}
