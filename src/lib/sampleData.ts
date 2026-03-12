export interface SalesRecord {
  date: string;
  month: string;
  quarter: string;
  year: number;
  region: string;
  product_category: string;
  product_name: string;
  revenue: number;
  quantity: number;
  profit: number;
}

export interface CustomerRecord {
  customer_id: number;
  name: string;
  region: string;
  signup_date: string;
  signup_month: string;
}

const regions = ['North', 'South', 'East', 'West'];
const categories = ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Food & Beverage'];
const products: Record<string, string[]> = {
  Electronics: ['Laptop Pro', 'Wireless Earbuds', 'Smart Watch', '4K Monitor'],
  Clothing: ['Premium Jacket', 'Running Shoes', 'Silk Scarf', 'Denim Jeans'],
  'Home & Garden': ['Robot Vacuum', 'Plant Kit', 'Smart Thermostat', 'LED Lamp'],
  Sports: ['Yoga Mat', 'Dumbbells Set', 'Tennis Racket', 'Cycling Helmet'],
  'Food & Beverage': ['Organic Coffee', 'Protein Bars', 'Green Tea Set', 'Sparkling Water'],
};

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function generateSalesData(): SalesRecord[] {
  const data: SalesRecord[] = [];
  let seed = 42;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const quarterMap: Record<string, string> = {
    Jan: 'Q1', Feb: 'Q1', Mar: 'Q1',
    Apr: 'Q2', May: 'Q2', Jun: 'Q2',
    Jul: 'Q3', Aug: 'Q3', Sep: 'Q3',
    Oct: 'Q4', Nov: 'Q4', Dec: 'Q4',
  };

  for (const year of [2023, 2024]) {
    for (let m = 0; m < 12; m++) {
      const month = months[m];
      for (const region of regions) {
        for (const category of categories) {
          const prods = products[category];
          for (const product of prods) {
            seed++;
            const qty = Math.floor(seededRandom(seed) * 80) + 10;
            seed++;
            const basePrice = seededRandom(seed) * 200 + 20;
            const rev = Math.round(qty * basePrice);
            const profit = Math.round(rev * (0.15 + seededRandom(seed + 1) * 0.35));
            const day = Math.floor(seededRandom(seed + 2) * 28) + 1;
            const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            data.push({
              date: dateStr,
              month: `${month} ${year}`,
              quarter: quarterMap[month],
              year,
              region,
              product_category: category,
              product_name: product,
              revenue: rev,
              quantity: qty,
              profit,
            });
          }
        }
      }
    }
  }
  return data;
}

export function generateCustomerData(): CustomerRecord[] {
  const data: CustomerRecord[] = [];
  let seed = 100;
  const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack'];
  const surnames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];

  for (let i = 1; i <= 500; i++) {
    seed++;
    const region = regions[Math.floor(seededRandom(seed) * regions.length)];
    seed++;
    const monthIdx = Math.floor(seededRandom(seed) * 24);
    const year = monthIdx < 12 ? 2023 : 2024;
    const m = (monthIdx % 12) + 1;
    seed++;
    const day = Math.floor(seededRandom(seed) * 28) + 1;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    data.push({
      customer_id: i,
      name: `${names[i % names.length]} ${surnames[Math.floor(i / names.length) % surnames.length]}`,
      region,
      signup_date: `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      signup_month: `${months[m - 1]} ${year}`,
    });
  }
  return data;
}

export const SCHEMA_DESCRIPTION = `
Database Schema:

Table: sales
Columns:
- date (TEXT) — format YYYY-MM-DD
- month (TEXT) — e.g. "Jan 2024"
- quarter (TEXT) — Q1, Q2, Q3, Q4
- year (INTEGER) — 2023 or 2024
- region (TEXT) — North, South, East, West
- product_category (TEXT) — Electronics, Clothing, Home & Garden, Sports, Food & Beverage
- product_name (TEXT) — specific product names within categories
- revenue (INTEGER) — revenue in dollars
- quantity (INTEGER) — units sold
- profit (INTEGER) — profit in dollars

Table: customers
Columns:
- customer_id (INTEGER)
- name (TEXT)
- region (TEXT) — North, South, East, West
- signup_date (TEXT) — format YYYY-MM-DD
- signup_month (TEXT) — e.g. "Jan 2024"

Data spans 2023-2024, 4 regions, 5 product categories with 4 products each.
`;
