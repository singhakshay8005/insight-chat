import { useState, useRef, useEffect, useCallback } from 'react';
import { BarChart3, Upload as UploadIcon } from 'lucide-react';
import { DownloadButton } from '@/components/DownloadButton';
import { ChatMessage } from '@/components/ChatMessage';
import { ChatInput } from '@/components/ChatInput';
import { Dashboard } from '@/components/Dashboard';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { CsvUploader } from '@/components/CsvUploader';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { processQuery, type ChartConfig, type ConversationMessage } from '@/lib/queryProcessor';
import { initDatabase } from '@/lib/database';

type UploadedTable = { name: string; columns: string[] };

interface Message {
  role: 'user' | 'assistant';
  content: string;
  charts?: ChartConfig[];
  sqlQuery?: string;
}

export default function Index() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [customSchema, setCustomSchema] = useState<string | null>(null);
  const [uploadedTables, setUploadedTables] = useState<UploadedTable[]>([]);
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

  const handleSchemaLoaded = useCallback((tableName: string, columns: string[]) => {
    setUploadedTables(prev => {
      const updated = [...prev.filter(t => t.name !== tableName), { name: tableName, columns }];
      const uploadedSchema = updated
        .map(t => `\nTable: ${t.name}\nColumns:\n${t.columns.map(c => `- ${c} (TEXT)`).join('\n')}`)
        .join('\n');
      setCustomSchema(
        `Database Schema:\n\nThe user has uploaded their own data. ONLY use the following tables for queries.\n${uploadedSchema}\n`
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

  const hasData = uploadedTables.length > 0;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* Chat Panel */}
        <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
          <div className="flex flex-col h-full border-r border-border bg-background">
            {/* Header */}
            <div className="p-4 border-b border-border space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-sm font-semibold text-foreground">BI Dashboard</h1>
                  <p className="text-xs text-muted-foreground">Upload data & ask questions</p>
                </div>
                <div className="ml-auto">
                  <button
                    onClick={() => setShowUploader(!showUploader)}
                    className={`p-2 rounded-lg transition-colors ${
                      showUploader
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                    title="Upload CSV"
                  >
                    <UploadIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {showUploader && <CsvUploader onSchemaLoaded={handleSchemaLoaded} />}
              {uploadedTables.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {uploadedTables.map(t => (
                    <span key={t.name} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      {t.name} ({t.columns.length} cols)
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                    <BarChart3 className="w-7 h-7 text-primary" />
                  </div>
                  <h2 className="text-lg font-semibold text-foreground mb-1">Welcome</h2>
                  <p className="text-sm text-muted-foreground mb-6 max-w-[280px]">
                    {hasData
                      ? 'Your data is loaded! Ask any question in plain English to get instant visual insights.'
                      : 'Upload a CSV file to get started. Then ask any question in plain English to analyze your data.'}
                  </p>
                  {!hasData && (
                    <button
                      onClick={() => setShowUploader(true)}
                      className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      Upload CSV to Begin
                    </button>
                  )}
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className="space-y-3">
                  <ChatMessage role={msg.role} content={msg.content} sqlQuery={msg.sqlQuery} />
                  {/* Mobile: show charts inline */}
                  {msg.charts && msg.charts.length > 0 && (
                    <div className="md:hidden space-y-2">
                      <div className="flex justify-end">
                        <DownloadButton charts={msg.charts} />
                      </div>
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
                suggestions={undefined}
              />
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="hidden lg:flex" />

        {/* Dashboard Panel (desktop) */}
        <ResizablePanel defaultSize={65} minSize={40}>
          <div className="hidden lg:flex flex-1 flex-col h-full bg-muted/30 overflow-y-auto p-6 scrollbar-thin">
            {latestCharts && latestCharts.length > 0 ? (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <DownloadButton charts={latestCharts} />
                </div>
                <Dashboard charts={latestCharts} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-20 h-20 rounded-3xl bg-secondary flex items-center justify-center mb-4">
                  <BarChart3 className="w-10 h-10 text-muted-foreground/40" />
                </div>
                <h3 className="text-base font-medium text-muted-foreground mb-1">Insights & Visuals</h3>
                <p className="text-sm text-muted-foreground/60 max-w-[320px]">
                  {hasData
                    ? 'Ask a question to see your data visualized here.'
                    : 'Upload a CSV file and ask questions to see charts and insights here.'}
                </p>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
