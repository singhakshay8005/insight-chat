import { SCHEMA_DESCRIPTION } from './sampleData';
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

const SYSTEM_PROMPT = `You are a Business Intelligence SQL analyst. You help users query a database and generate visualizations.

SCHEMA_PLACEHOLDER

INSTRUCTIONS:
1. Analyze the user's natural language question
2. Generate a valid SQL query using only the tables and columns described above
3. Choose the best chart type(s) for the data
4. Return a JSON response

CHART SELECTION RULES (CRITICAL — choose the BEST chart type for each query):
- Time series / trends over months, quarters, years → "line"
- Comparing values across categories (regions, products, etc.) → "bar"
- Showing proportions or share of a total (market share, distribution) → "pie"
- Cumulative or stacked trends over time → "area"
- Ranking or "top N" queries → "bar" (horizontal preferred, use ORDER BY DESC)
- Growth or change over time → "line"
- When user asks "compare" across categories → "bar"
- When user asks "trend" or "over time" → "line"
- When user asks "breakdown" or "share" or "distribution" → "pie"
- When comparing across categories AND time, use multiple charts with DIFFERENT types
- NEVER default to bar charts for everything — analyze the question intent carefully
- For a single query, pick the ONE best chart type that matches the data pattern

RESPONSE FORMAT (return ONLY valid JSON, no markdown):
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
  "message": "Brief explanation of what the dashboard shows"
}

RULES:
- Use only columns that exist in the schema
- Always use aggregate functions (SUM, COUNT, AVG) with GROUP BY when summarizing
- If data doesn't exist, set sql_queries to [] and explain in message
- Generate 1-4 charts depending on query complexity
- For "top" queries use ORDER BY ... DESC LIMIT
- Always alias computed columns clearly (e.g. SUM(revenue) AS total_revenue)
- For month ordering, use: ORDER BY MIN(date) when grouping by month
- NEVER use EXTRACT, strftime, or date functions. Use the month, quarter, year columns directly.
- Do not use markdown formatting in the JSON response
`;

export async function processQuery(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  customSchema?: string
): Promise<QueryResult> {
  const schema = customSchema || SCHEMA_DESCRIPTION;
  const systemPrompt = SYSTEM_PROMPT.replace(SCHEMA_DESCRIPTION, schema);

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

    // Parse the JSON response
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
