import { executeQuery } from './database';

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
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bi-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return { message: 'Rate limit exceeded. Please wait a moment and try again.', charts: [] };
      }
      if (response.status === 402) {
        return { message: 'AI credits exhausted. Please add credits in your Lovable workspace settings.', charts: [] };
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
        charts.push({
          type: pickChartType(q.chart?.type, data.length, x),
          title: q.chart?.title || 'Result',
          x_axis: x,
          y_axis: y,
          data,
        });
      }
    }

    const message = cleanMessage(parsed.message);

    if (charts.length === 0) {
      return {
        message: message || "I looked for that but couldn't find matching values in your data. Try naming a column from your file.",
        charts: [],
        sql_query: lastSql,
      };
    }

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
