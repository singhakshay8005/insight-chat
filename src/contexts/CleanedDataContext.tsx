import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PipelineResult } from '@/lib/dataCleaning';

export interface ChatReadyData extends PipelineResult {
  fileName: string;
}

interface CleanedDataContextValue {
  chatReadyData: ChatReadyData | null;
  saveChatReadyData: (data: ChatReadyData) => void;
}

const CleanedDataContext = createContext<CleanedDataContextValue | undefined>(undefined);

export function CleanedDataProvider({ children }: { children: ReactNode }) {
  const [chatReadyData, setChatReadyData] = useState<ChatReadyData | null>(null);
  const value = useMemo(() => ({ chatReadyData, saveChatReadyData: setChatReadyData }), [chatReadyData]);

  return <CleanedDataContext.Provider value={value}>{children}</CleanedDataContext.Provider>;
}

export function useCleanedData() {
  const context = useContext(CleanedDataContext);
  if (!context) throw new Error('useCleanedData must be used inside CleanedDataProvider');
  return context;
}