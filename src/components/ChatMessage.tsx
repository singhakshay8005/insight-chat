import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { MessageSquare, Bot } from 'lucide-react';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  sqlQuery?: string;
}

export function ChatMessage({ role, content, sqlQuery }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${isUser ? 'bg-primary/20' : 'bg-secondary'}`}>
        {isUser ? (
          <MessageSquare className="w-4 h-4 text-primary" />
        ) : (
          <Bot className="w-4 h-4 text-primary" />
        )}
      </div>
      <div className={`max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <div className={`rounded-xl px-4 py-3 ${isUser ? 'bg-primary/10 border border-primary/20' : 'bg-secondary'}`}>
          <div className="prose prose-sm prose-invert max-w-none text-foreground text-sm leading-relaxed">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </div>
        {sqlQuery && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2"
          >
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-primary transition-colors font-mono">
                View SQL Query
              </summary>
              <pre className="mt-1 p-3 bg-muted rounded-lg text-xs font-mono text-muted-foreground overflow-x-auto">
                {sqlQuery}
              </pre>
            </details>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
