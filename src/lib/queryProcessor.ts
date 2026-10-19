import { executeQuery } from './database';
import { postChat } from '@/api/client';

export interface ChartConfig {
  type: 'line' | 'bar' | 'pie' | 'area';
  title: string;
  x_axis: string;
  y_axis: string;
  data: Record<string, unknown>[];
}

export interface QueryResult {
  message: string;
  charts: ChartConfig[];
  sql_query?: string;
  error?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are a friendly Business Intelligence analyst. You help non-technical users understand their data using simple language.

SCHEMA_PLACEHOLDER

YOUR JOB:
1. Read the user's plain English question carefully
2. Write correct SQL to answer it using ONLY the tables/columns listed above
3. Pick the BEST chart type to visualize the answer
4. Write a clear, simple explanation a non-technical person can understand

CHART TYPE GUIDE (pick the one that BEST fits the data):
- "bar" → Comparing categories side by side (e.g. "sales by region", "top 5 products", rankings)
- "pie" → Showing parts of a whole / proportions (e.g. "market share", "breakdown by category", percentages)
- "line" → Trends over time (e.g. "monthly revenue", "growth over years", time series)
- "area" → Same as line but emphasizing volume/magnitude over time

CRITICAL RULES FOR CHOOSING CHARTS:
- If the query result has ≤6 categories and asks about share/proportion → use "pie"
- If the query asks "how much of each" or "breakdown" → use "pie"
- If the query asks "top N" or "compare" across groups → use "bar"
- If the query involves dates, months, years as the x-axis → use "line"
- If there are >8 categories, NEVER use pie → use "bar" instead
- ALWAYS set x_axis to the label/category column and y_axis to the numeric/value column
- The x_axis and y_axis MUST exactly match column names or aliases in your SQL SELECT

MESSAGE RULES:
- Write as if talking to a business person, NOT a developer
- Use **bold** for important numbers
- Include specific values from the data
- Keep it concise but insightful (3-5 sentences)
- NO technical jargon — no mention of SQL, queries, tables, etc.

SQL RULES:
- Use ONLY the exact column names from the schema (they are case-sensitive)
- Always alias aggregates clearly: SUM(amount) AS total_amount
- Use GROUP BY for any aggregation
- For "top N" use ORDER BY ... DESC LIMIT N
- NEVER use EXTRACT(), strftime(), DATE_TRUNC() or any date functions — use columns directly
- Column names with spaces are stored with underscores (e.g. "Sales Amount" → Sales_Amount)
- Wrap column names in square brackets if they contain special chars: [Column_Name]
- ALWAYS test that your x_axis and y_axis field names match your SELECT aliases exactly

RESPONSE FORMAT (return ONLY valid JSON, NO markdown fences, NO extra text):
{
  "sql_queries": [
    {
      "sql": "SELECT category, SUM(amount) AS total FROM sales GROUP BY category ORDER BY total DESC",
      "chart": {
        "type": "bar",
        "title": "Sales by Category",
        "x_axis": "category",
        "y_axis": "total"
      }
    }
  ],
  "message": "Here's a breakdown of your sales..."
}
`;

interface PlanQuery {
  sql: string;
  chart?: { type?: string; title?: string; x_axis?: string; y_axis?: string };
}
interface Plan {
  sql_queries: PlanQuery[];
  message?: string;
}

function pickChartType(type: string | undefined, rowCount: number, xAxis: string): ChartConfig['type'] {
  const allowed = ['line', 'bar', 'pie', 'area'];
  let t = allowed.includes(type ?? '') ? (type as ChartConfig['type']) : 'bar';
  if (t === 'pie' && rowCount > 8) t = 'bar';
  if (/date|month|year|day|time|quarter|week/i.test(xAxis) && (t === 'bar' || t === 'pie')) t = 'line';
  return t;
}

// Turns whatever the model returned into a usable plan, even if it replied with
// prose or a bare SQL statement instead of the requested JSON.
function extractPlan(content: string): Plan | null {
  if (!content) return null;

  const withoutFences = content.replace(/```(?:json|sql)?/gi, '```');
  const jsonCandidates: string[] = [];
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start !== -1 && end > start) jsonCandidates.push(withoutFences.slice(start, end + 1));
  jsonCandidates.push(withoutFences.replace(/```/g, '').trim());

  for (const candidate of jsonCandidates) {
    try {
      const obj = JSON.parse(candidate);
      if (obj && Array.isArray(obj.sql_queries)) return obj as Plan;
      if (obj && typeof obj.sql === 'string') {
        return { sql_queries: [{ sql: obj.sql, chart: obj.chart }], message: obj.message };
      }
    } catch {
      // try next candidate
    }
  }

  // Last resort: pull a raw SELECT statement out of the text.
  const sqlMatch = content.match(/SELECT[\s\S]*?(?:;|```|$)/i);
  if (sqlMatch) {
    const sql = sqlMatch[0].replace(/```/g, '').replace(/;\s*$/, '').trim();
    if (sql.length > 10) return { sql_queries: [{ sql }] };
  }
  return null;
}

// Never show SQL or code blocks to the user.
function cleanMessage(message: string | undefined): string {
  if (!message) return '';
  let m = message.replace(/```[\s\S]*?```/g, '').trim();
  if (/^\s*SELECT\b/i.test(m) || /\bFROM\b[\s\S]*\bGROUP BY\b/i.test(m)) {
    m = m.replace(/SELECT[\s\S]*?(?:;|$)/gi, '').trim();
  }
  return m;
}

function formatNumber(v: unknown): string {
  if (typeof v !== 'number') return String(v);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Deterministic, always-correct fallback description built straight from the rows.
function localSummary(charts: ChartConfig[]): string {
  const parts: string[] = [];
  for (const c of charts) {
    const rows = c.data.filter(r => typeof r[c.y_axis] === 'number') as Record<string, number | string>[];
    if (rows.length === 0) continue;
    // Deterministic ranking: value desc, then label asc so ties always resolve the same way.
    const sorted = [...rows].sort((a, b) => {
      const diff = (b[c.y_axis] as number) - (a[c.y_axis] as number);
      if (diff !== 0) return diff;
      return String(a[c.x_axis]).localeCompare(String(b[c.x_axis]));
    });
    const top = sorted[0];
    const low = sorted[sorted.length - 1];
    const total = sorted.reduce((s, r) => s + (r[c.y_axis] as number), 0);
    let line = `**${String(top[c.x_axis])}** is highest at **${formatNumber(top[c.y_axis])}**`;
    if (sorted.length > 1) {
      line += `, and **${String(low[c.x_axis])}** is lowest at **${formatNumber(low[c.y_axis])}**`;
    }
    line += `. Across ${sorted.length} ${sorted.length === 1 ? 'entry' : 'entries'} the total is **${formatNumber(total)}**.`;
    parts.push(line);
  }
  return parts.join(' ');
}

async function summarizeFromResults(userMessage: string, charts: ChartConfig[]): Promise<string> {
  const fallback = localSummary(charts);
  // Give the model ONLY the computed rows so it cannot invent values.
  const tables = charts
    .map(c => {
      const rows = c.data.slice(0, 40).map(r => `${String(r[c.x_axis])}: ${formatNumber(r[c.y_axis])}`).join('\n');
      return `${c.title} (${c.x_axis} → ${c.y_axis}):\n${rows}`;
    })
    .join('\n\n');

      try {
    const response = await postChat([
      {
        role: 'system',
        content:
          'You explain business results to a non-technical person in 2-4 short sentences.\n' +
          'You are given the FINAL computed results. Use ONLY these numbers and labels.\n' +
          'Never invent, guess or change a label or value. The highest value is whichever row actually has the largest number here.\n' +
          'Bold key figures with **. No SQL, no tables, no jargon, no bullet lists.',
      },
      { role: 'user', content: `Question: ${userMessage}\n\nResults:\n${tables}` },
    ]);
    if (!response.ok) return fallback;
    const json = await response.json();
    const text = cleanMessage(json.choices?.[0]?.message?.content || '');
    return text || fallback;
  } catch {
    return fallback;
  }
}

export async function processQuery(


  userMessage: string,
  conversationHistory: ConversationMessage[],
  schema?: string
): Promise<QueryResult> {
  if (!schema) {
    return {
      message: 'No data has been loaded yet. Please upload a CSV file first to start analyzing your data.',
      charts: [],
    };
  }

  const systemPrompt = SYSTEM_PROMPT.replace('SCHEMA_PLACEHOLDER', schema);

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: userMessage },
  ];

  try {
    const response = await postChat(messages);

    if (!response.ok) {
      if (response.status === 429) {
        return { message: 'Rate limit exceeded. Please wait a moment and try again.', charts: [] };
      }
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';

    const parsed = extractPlan(content);
    if (!parsed) {
      return {
        message: "I couldn't work that one out. Try asking it a slightly different way — for example \"total sales by month\" or \"top 5 products by revenue\".",
        charts: [],
      };
    }

    const charts: ChartConfig[] = [];
    let lastSql = '';

    for (const q of parsed.sql_queries || []) {
      if (!q?.sql) continue;
      lastSql = q.sql;
      const { data, error } = executeQuery(q.sql);
      if (error) continue;
      if (data.length > 0) {
        const cols = Object.keys(data[0]);
        const numericCol = cols.find(c => typeof data[0][c] === 'number');
        const labelCol = cols.find(c => c !== numericCol);
        const x = cols.includes(q.chart?.x_axis) ? q.chart.x_axis : (labelCol ?? cols[0]);
        const y = cols.includes(q.chart?.y_axis) ? q.chart.y_axis : (numericCol ?? cols[1] ?? cols[0]);
        const type = pickChartType(q.chart?.type, data.length, x);
        // Rank bar/pie charts by the metric (desc), breaking ties by label so
        // the visual order always matches the written answer. Time series keep
        // their chronological order.
        const ranked = (type === 'bar' || type === 'pie')
          ? [...data].sort((a, b) => {
              const av = typeof a[y] === 'number' ? (a[y] as number) : -Infinity;
              const bv = typeof b[y] === 'number' ? (b[y] as number) : -Infinity;
              if (bv !== av) return bv - av;
              return String(a[x]).localeCompare(String(b[x]));
            })
          : data;
        charts.push({
          type,
          title: q.chart?.title || 'Result',
          x_axis: x,
          y_axis: y,
          data: ranked,
        });
      }
    }

    if (charts.length === 0) {
      return {
        message: cleanMessage(parsed.message) || "I looked for that but couldn't find matching values in your data. Try naming a column from your file.",
        charts: [],
        sql_query: lastSql,
      };
    }

    // The first answer is written before the numbers exist, so it can be wrong.
    // Rewrite it from the real results.
    const message = await summarizeFromResults(userMessage, charts);


    return {
      message: message || 'Here are your results.',
      charts,
      sql_query: lastSql,
    };

  } catch (e) {
    console.error('Query processing error:', e);
    return {
      message: `Error: ${e instanceof Error ? e.message : 'Unknown error occurred'}. Please try again.`,
      charts: [],
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}
