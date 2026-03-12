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

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as Record<string, unknown>[];
        if (rows.length === 0) {
          toast.error('CSV file is empty');
          return;
        }

        const tableName = file.name.replace(/\.csv$/i, '').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
        const columns = Object.keys(rows[0]);

        loadCsvData(tableName, rows);
        setFileName(file.name);
        onSchemaLoaded(tableName, columns);
        toast.success(`Loaded ${rows.length} rows into table "${tableName}"`);
      },
      error: (err) => {
        toast.error(`CSV parse error: ${err.message}`);
      },
    });
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
