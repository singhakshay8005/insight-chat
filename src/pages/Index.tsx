import { useState, useRef, useEffect, useCallback } from 'react';
import { BarChart3, Database, Upload as UploadIcon } from 'lucide-react';
import { ChatMessage } from '@/components/ChatMessage';
import { ChatInput } from '@/components/ChatInput';
import { Dashboard } from '@/components/Dashboard';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { CsvUploader } from '@/components/CsvUploader';
import { processQuery, type ChartConfig, type ConversationMessage } from '@/lib/queryProcessor';
import { initDatabase } from '@/lib/database';
import { SCHEMA_DESCRIPTION } from '@/lib/sampleData';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  charts?: ChartConfig[];
  sqlQuery?: string;
}

const SUGGESTIONS = [
  'Show monthly revenue for 2024',
  'Compare revenue by region',
  'Top 5 product categories by profit',
  'Customer growth month by month',
];

export default function Index() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [customSchema, setCustomSchema] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatConversation = useRef<ConversationMessage[]>([]);

  useEffect(() => {
    initDatabase();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const [uploadedTables, setUploadedTables] = useState<{ name: string; columns: string[] }[]>([]);

  const handleSchemaLoaded = useCallback((tableName: string, columns: string[]) => {
    setUploadedTables(prev => {
      const updated = [...prev.filter(t => t.name !== tableName), { name: tableName, columns }];
      const uploadedSchema = updated
        .map(t => `\nTable: ${t.name}\nColumns:\n${t.columns.map(c => `- ${c} (TEXT)`).join('\n')}`)
        .join('\n');
      setCustomSchema(
        `Database Schema:\n\nThe user has uploaded their own data. ONLY use the following tables for queries. Do NOT reference sales or customers tables.\n${uploadedSchema}\n`
      );
      return updated;
    });
  }, []);

  const handleSend = useCallback(async (input: string) => {
    const userMsg: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    chatConversation.current.push({ role: 'user', content: input });
    setIsLoading(true);

    try {
      const result = await processQuery(input, chatConversation.current.slice(0, -1), customSchema || undefined);

      const assistantMsg: Message = {
        role: 'assistant',
        content: result.message,
        charts: result.charts,
        sqlQuery: result.sql_query,
      };

      chatConversation.current.push({ role: 'assistant', content: result.message });
      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      const errMsg: Message = { role: 'assistant', content: 'Something went wrong. Please try again.' };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [customSchema]);

  const latestCharts = [...messages].reverse().find(m => m.charts && m.charts.length > 0)?.charts;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar / Chat */}
      <div className="w-full lg:w-[420px] flex flex-col border-r border-border bg-background">
        {/* Header */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center glow">
              <BarChart3 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground">BI Dashboard</h1>
              <p className="text-xs text-muted-foreground">Ask questions, get charts</p>
            </div>
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => setShowUploader(!showUploader)}
                className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Upload CSV"
              >
                <UploadIcon className="w-4 h-4" />
              </button>
              <div className="p-2 rounded-lg bg-secondary" title="Sample data loaded">
                <Database className="w-4 h-4 text-primary" />
              </div>
            </div>
          </div>
          {showUploader && <CsvUploader onSchemaLoaded={handleSchemaLoaded} />}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 glow">
                <BarChart3 className="w-7 h-7 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Welcome</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-[280px]">
                Ask any business question in plain English and get instant visual insights.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className="space-y-3">
              <ChatMessage role={msg.role} content={msg.content} sqlQuery={msg.sqlQuery} />
              {msg.charts && msg.charts.length > 0 && (
                <div className="lg:hidden">
                  <Dashboard charts={msg.charts} />
                </div>
              )}
            </div>
          ))}
          {isLoading && <LoadingIndicator />}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border">
          <ChatInput
            onSend={handleSend}
            isLoading={isLoading}
            suggestions={messages.length === 0 ? SUGGESTIONS : undefined}
          />
        </div>
      </div>

      {/* Dashboard Panel (desktop) */}
      <div className="hidden lg:flex flex-1 flex-col bg-muted/30 overflow-y-auto p-6 scrollbar-thin">
        {latestCharts && latestCharts.length > 0 ? (
          <Dashboard charts={latestCharts} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 rounded-3xl bg-secondary flex items-center justify-center mb-4">
              <BarChart3 className="w-10 h-10 text-muted-foreground/40" />
            </div>
            <h3 className="text-base font-medium text-muted-foreground mb-1">Dashboard Area</h3>
            <p className="text-sm text-muted-foreground/60 max-w-[320px]">
              Your charts will appear here once you ask a question.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
