import { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, X } from 'lucide-react';
import Papa from 'papaparse';
import { loadCsvData } from '@/lib/database';
import { toast } from 'sonner';

interface CsvUploaderProps {
  onSchemaLoaded: (tableName: string, columns: string[]) => void;
}

export function CsvUploader({ onSchemaLoaded }: CsvUploaderProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const isReadableText = (text: string): boolean => {
    // Check if string contains mostly printable ASCII/unicode characters
    const nonPrintable = text.replace(/[\x20-\x7E\u00A0-\uFFFF]/g, '');
    return nonPrintable.length < text.length * 0.1; // Allow up to 10% non-printable
  };

  const sanitizeColumnName = (name: string): string => {
    // Remove non-printable characters, trim, replace spaces with underscores
    return name
      .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'column';
  };

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }

    // Read first bytes to check for binary content
    const headerReader = new FileReader();
    headerReader.onload = () => {
      const firstChunk = headerReader.result as string;
      if (!isReadableText(firstChunk.slice(0, 500))) {
        toast.error('This file appears to contain binary data, not CSV text. Please convert it to a proper CSV file first.');
        return;
      }

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        encoding: 'UTF-8',
        complete: (results) => {
          const rows = results.data as Record<string, unknown>[];
          if (rows.length === 0) {
            toast.error('CSV file is empty');
            return;
          }

          const rawColumns = Object.keys(rows[0]);
          
          // Validate columns are readable
          const readableColumns = rawColumns.filter(c => isReadableText(c) && c.trim().length > 0);
          if (readableColumns.length === 0) {
            toast.error('Could not detect valid column names. The file may not be a proper CSV.');
            return;
          }

          // Sanitize column names and remap rows
          const columnMap = new Map<string, string>();
          const seenNames = new Set<string>();
          for (const col of readableColumns) {
            let sanitized = sanitizeColumnName(col);
            // Handle duplicate names
            let unique = sanitized;
            let counter = 1;
            while (seenNames.has(unique)) {
              unique = `${sanitized}_${counter++}`;
            }
            seenNames.add(unique);
            columnMap.set(col, unique);
          }

          const cleanRows = rows.map(row => {
            const clean: Record<string, unknown> = {};
            for (const [original, sanitized] of columnMap) {
              clean[sanitized] = row[original];
            }
            return clean;
          });

          const tableName = file.name.replace(/\.csv$/i, '').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
          const finalColumns = Array.from(columnMap.values());

          loadCsvData(tableName, cleanRows);
          setFileName(file.name);
          onSchemaLoaded(tableName, finalColumns);
          toast.success(`Loaded ${cleanRows.length} rows with ${finalColumns.length} columns into "${tableName}"`);
        },
        error: (err) => {
          toast.error(`CSV parse error: ${err.message}`);
        },
      });
    };
    headerReader.readAsText(file.slice(0, 1024));
  }, [onSchemaLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  return (
    <div className="space-y-2">
      {!fileName ? (
        <label
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            isDragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
          }`}
        >
          <Upload className="w-6 h-6 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Drop CSV or click to upload</span>
          <input type="file" accept=".csv" className="hidden" onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) processFile(file);
          }} />
        </label>
      ) : (
        <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg">
          <FileSpreadsheet className="w-4 h-4 text-primary" />
          <span className="text-xs text-foreground flex-1 truncate">{fileName}</span>
          <button onClick={() => setFileName(null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
