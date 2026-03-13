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

const SYSTEM_PROMPT = `You are a friendly Business Intelligence analyst who helps users understand their data. You speak in plain, human-readable English.

SCHEMA_PLACEHOLDER

INSTRUCTIONS:
1. Understand the user's question asked in plain English
2. Generate SQL queries to answer it using ONLY the tables and columns above
3. Choose the best chart type(s) for visualizing the results
4. Write a detailed, insightful "message" that explains the findings in plain English as if you were presenting to a business stakeholder

CHART SELECTION RULES:
- Time series / trends over months, quarters, years → "line"
- Comparing values across categories (regions, products, etc.) → "bar"
- Showing proportions or share of a total → "pie"
- Cumulative or stacked trends over time → "area"
- Ranking or "top N" queries → "bar" (use ORDER BY DESC)
- When user asks "compare" across categories → "bar"
- When user asks "trend" or "over time" → "line"
- When user asks "breakdown" or "share" or "distribution" → "pie"
- NEVER default to bar charts for everything — match the question intent

MESSAGE RULES (CRITICAL):
- The "message" field MUST be a detailed, human-readable explanation in plain English
- Include specific numbers, percentages, and key takeaways from the data
- Highlight trends, comparisons, and actionable insights
- Write as if explaining to a non-technical business user
- Use markdown formatting (bold, bullet points, headers) to make it readable
- Example: "**Monthly Revenue for 2024** shows a steady upward trend, starting at **$1.2M in January** and reaching **$2.1M by December** — a **75% increase**. The strongest growth occurred in Q3."

RESPONSE FORMAT (return ONLY valid JSON, no markdown code fences):
{
  "sql_queries": [
    {
      "sql": "SELECT ...",
      "chart": {
        "type": "line|bar|pie|area",
        "title": "Chart Title",
        "x_axis": "column_name_for_x",
        "y_axis": "column_name_for_y"
      }
    }
  ],
  "message": "Your detailed human-readable analysis here with **bold** numbers and insights"
}

SQL RULES:
- Use only columns that exist in the schema
- Always use aggregate functions (SUM, COUNT, AVG) with GROUP BY when summarizing
- If data doesn't exist, set sql_queries to [] and explain in message
- Generate 1-4 charts depending on query complexity
- For "top" queries use ORDER BY ... DESC LIMIT
- Always alias computed columns clearly (e.g. SUM(revenue) AS total_revenue)
- For month ordering, use: ORDER BY MIN(date) when grouping by month
- NEVER use EXTRACT, strftime, or date functions. Use the existing columns directly.
`;

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

    let parsed: { sql_queries: { sql: string; chart: { type: string; title: string; x_axis: string; y_axis: string } }[]; message: string };
    try {
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return { message: content || 'I couldn\'t understand the response. Please try rephrasing your question.', charts: [] };
    }

    const charts: ChartConfig[] = [];
    let lastSql = '';

    for (const q of parsed.sql_queries || []) {
      lastSql = q.sql;
      const { data, error } = executeQuery(q.sql);
      if (error) {
        return { message: `SQL Error: ${error}`, charts: [], sql_query: q.sql, error };
      }
      if (data.length > 0) {
        charts.push({
          type: q.chart.type as ChartConfig['type'],
          title: q.chart.title,
          x_axis: q.chart.x_axis,
          y_axis: q.chart.y_axis,
          data,
        });
      }
    }

    return {
      message: parsed.message || 'Here are your results.',
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
