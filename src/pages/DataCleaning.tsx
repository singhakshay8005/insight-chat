import { useMemo, useRef, useState, type DragEvent } from 'react';
import { ArrowLeft, Check, Clipboard, Database, FileSpreadsheet, FileUp, LoaderCircle, RotateCcw, Sparkles, Upload, WandSparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useCleanedData } from '@/contexts/CleanedDataContext';
import { runPipeline, SOURCE_INDEX, type PipelineResult, type SchemaColumn } from '@/lib/dataCleaning';

const demoCsv = `Order Date,City,Product,Total Sales (Rs),Paid,Notes
2024-01-15,delhi,Notebook,"Rs 1,500",true,January order
15/01/2024,DELHI,Pen,"Rs 250",true,
01-15-2024,Delhi ,Desk,"Rs 12,000",false,N/A
2024-01-18,Mumbai,Notebook,"Rs 2,250",true,repeat customer
2024-01-19,Jaipur,Chair,"Rs 4,500",true,
2024-01-20,delhi,Pen,"Rs 450",false,online
21/01/2024,Chennai,Desk,"Rs 15,000",true,priority
2024-01-22,Pune,Notebook,"Rs 750",true,N/A
01-23-2024,DELHI,Chair,"Rs 3,000",false,store
2024-01-24,Mumbai,Pen,"Rs 300",true,
2024-01-25,Delhi ,Notebook,"Rs 1,050",true,January order
26/01/2024,Jaipur,Desk,"Rs 9,500",false,online
2024-01-27,Chennai,Chair,"Rs 5,250",true,
01-28-2024,Pune,Pen,"Rs 600",true,N/A
2024-01-29,Mumbai,Desk,"Rs 18,000",true,priority
2024-01-30,delhi,Notebook,"Rs 1,500",true,January order
31/01/2024,Jaipur,Pen,"Rs 350",false,store
2024-02-01,Chennai,Desk,"Rs 11,000",true,
02-02-2024,Pune,Chair,"Rs 6,250",true,online
2024-02-03,DELHI,Notebook,"Rs 900",false,N/A
2024-02-04,Mumbai,Pen,"Rs 500",true,repeat customer
05/02/2024,Jaipur,Chair,"Rs 3,750",true,
2024-02-06,Chennai,Notebook,"Rs 1,250",false,
2024-02-07,Pune,Desk,"Rs 14,500",true,priority
02-08-2024,Delhi ,Pen,"Rs 400",true,store
2024-02-09,Mumbai,Chair,"Rs 5,000",false,N/A
2024-02-10,Jaipur,Notebook,"Rs 1,700",true,online
11/02/2024,Chennai,Pen,"Rs 275",true,
2024-02-12,Pune,Chair,"Rs 7,500",false,repeat customer
2024-02-13,DELHI,Desk,"Rs 20,000",true,priority
2024-02-14,Mumbai,Notebook,"Rs 1,500",true,January order
2024-01-15,delhi,Notebook,"Rs 1,500",true,January order
2024-02-12,Pune,Chair,"Rs 7,500",false,repeat customer`;

type PreviewMode = 'raw' | 'cleaned';

function prettyFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function printable(value: unknown) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function sameValue(left: unknown, right: unknown) {
  return String(left ?? '') === String(right ?? '');
}

function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.map(escape).join(','), ...rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\r\n');
}

function schemaTableValue(column: SchemaColumn) {
  if (column.min === null && column.max === null) return '—';
  return `${printable(column.min)} / ${printable(column.max)}`;
}

export default function DataCleaning() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('raw');
  const [copied, setCopied] = useState(false);
  const { saveChatReadyData } = useCleanedData();

  const columns = useMemo(() => result?.schema.map(column => column.name) ?? [], [result]);
  const rawColumns = useMemo(() => Object.keys(result?.rawRows[0] ?? {}), [result]);
  const navigate = useNavigate();

  const handleClean = async (nextFile: File) => {
    setBusy(true);
    try {
      const pipelineResult = await runPipeline(nextFile);
      setFile(nextFile);
      setResult(pipelineResult);
      setPreviewMode('raw');
      toast.success('Your file is ready to review.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read this CSV file.');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile) {
      if (!droppedFile.name.toLowerCase().endsWith('.csv')) {
        toast.error('Choose a CSV file to continue.');
        return;
      }
      setFile(droppedFile);
      setResult(null);
    }
  };

  const loadSample = () => {
    const sampleFile = new File([demoCsv], 'messy-sales-demo.csv', { type: 'text/csv' });
    void handleClean(sampleFile);
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setPreviewMode('raw');
    if (inputRef.current) inputRef.current.value = '';
  };

  const downloadCleaned = () => {
    if (!result) return;
    const blob = new Blob([toCsv(result.cleanedRows, columns)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${file?.name.replace(/\.csv$/i, '') || 'data'}-cleaned.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copySchema = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.schemaText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy the schema.');
    }
  };

  const useForChat = () => {
    if (!result || !file) return;
    saveChatReadyData({ ...result, fileName: file.name });
    toast.success('Your cleaned data is ready — ask your questions in the chat.');
    navigate('/');
  };

  const report = result?.report;
  const summary = [
    { label: 'Rows', value: report ? `${report.rowsBefore} → ${report.rowsAfter}` : '—', icon: FileSpreadsheet },
    { label: 'Columns', value: report ? `${report.columnsBefore} → ${report.columnsAfter}` : '—', icon: Database },
    { label: 'Duplicates removed', value: report?.duplicatesRemoved ?? '—', icon: RotateCcw },
    { label: 'Empty rows removed', value: report?.emptyRowsRemoved ?? '—', icon: FileUp },
    { label: 'Columns dropped', value: report?.columnsDropped.length ?? '—', icon: WandSparkles },
    { label: 'Missing values filled', value: report ? Object.values(report.missingFilled).reduce((sum, item) => sum + item.count, 0) : '—', icon: Sparkles },
    { label: 'Outliers flagged', value: report ? Object.values(report.outliersFlagged).reduce((sum, item) => sum + item.count, 0) : '—', icon: Check },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link to="/" aria-label="Back to dashboard" className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
              <WandSparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold">Data upload & cleaning</h1>
              <p className="text-xs text-muted-foreground">Prepare a file for analysis</p>
            </div>
          </div>
          <Link to="/" className="hidden items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section aria-labelledby="upload-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="upload-heading" className="text-lg font-semibold">Upload your data</h2>
              <p className="mt-1 text-sm text-muted-foreground">Select a CSV file to inspect its rows and columns.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={loadSample} disabled={busy}>
              <FileSpreadsheet /> Load sample messy data
            </Button>
          </div>

          <div
            onDragOver={event => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`rounded-lg border border-dashed p-5 transition-colors sm:p-7 ${dragOver ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={event => {
                const chosen = event.target.files?.[0];
                if (!chosen) return;
                if (!chosen.name.toLowerCase().endsWith('.csv')) {
                  toast.error('Choose a CSV file to continue.');
                  event.target.value = '';
                  return;
                }
                setFile(chosen);
                setResult(null);
              }}
            />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
                {busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file ? file.name : 'Drop your CSV file here'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {file ? prettyFileSize(file.size) : 'CSV format only · Your file stays on this device'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
                  Browse file
                </Button>
                <Button type="button" onClick={() => file && void handleClean(file)} disabled={!file || busy}>
                  {busy ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}
                  {busy ? 'Reading…' : 'Clean Data'}
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={reset} disabled={!file || busy} aria-label="Reset selected file" title="Reset">
                  <RotateCcw />
                </Button>
              </div>
            </div>
          </div>
        </section>

        {!result ? (
          <section className="flex min-h-64 flex-col items-center justify-center border-t border-border px-4 py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <h2 className="text-base font-medium">Upload a CSV to get started</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">Your file summary, preview, and schema will appear here.</p>
          </section>
        ) : (
          <>
            <section aria-labelledby="summary-heading">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 id="summary-heading" className="text-lg font-semibold">Cleaning summary</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{file?.name} · {result.rawRows.length.toLocaleString()} records inspected</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                {summary.map(item => {
                  const Icon = item.icon;
                  return (
                    <Card key={item.label} className="rounded-md border-border bg-card p-3 shadow-none">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Icon className="h-4 w-4" />
                        <span className="text-xs leading-tight">{item.label}</span>
                      </div>
                      <p className="mt-3 text-lg font-semibold tabular-nums">{item.value}</p>
                    </Card>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="report-heading" className="border-t border-border pt-5">
              <div className="mb-3">
                <h2 id="report-heading" className="text-lg font-semibold">Cleaning report</h2>
                <p className="mt-1 text-sm text-muted-foreground">Detected details from the selected file.</p>
              </div>
              <Tabs defaultValue="renames">
                <div className="overflow-x-auto pb-1">
                  <TabsList className="w-max">
                    <TabsTrigger value="renames">Column Renames</TabsTrigger>
                    <TabsTrigger value="types">Type Detection</TabsTrigger>
                    <TabsTrigger value="missing">Missing Values</TabsTrigger>
                    <TabsTrigger value="outliers">Outliers</TabsTrigger>
                    <TabsTrigger value="warnings">Warnings</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="renames">
                  <ReportTable headers={['Original column', 'New column']} rows={Object.entries(report?.renamedColumns ?? {}).map(([original, updated]) => [original, updated])} empty="No column names were changed." />
                </TabsContent>
                <TabsContent value="types">
                  <ReportTable headers={['Column', 'Detected type', 'Unique values', 'Nulls']} rows={result.schema.map(column => [column.name, column.sqlType, String(column.uniqueCount), String(column.nullCount)])} empty="No column types detected." />
                </TabsContent>
                <TabsContent value="missing">
                  <ReportTable headers={['Column', 'Values filled', 'Method', 'Value']} rows={Object.entries(report?.missingFilled ?? {}).map(([name, detail]) => [name, String(detail.count), detail.method, printable(detail.value)])} empty="No missing values were filled." />
                </TabsContent>
                <TabsContent value="outliers">
                  <ReportTable headers={['Column', 'Flagged', 'Lower bound', 'Upper bound']} rows={Object.entries(report?.outliersFlagged ?? {}).map(([name, detail]) => [name, String(detail.count), String(detail.lowerBound), String(detail.upperBound)])} empty="No outliers were flagged." />
                </TabsContent>
                <TabsContent value="warnings">
                  {(report?.warnings.length ?? 0) ? (
                    <ul className="space-y-2 border-t border-border py-3">
                      {report?.warnings.map((warning, index) => <li key={`${warning}-${index}`} className="text-sm text-muted-foreground">{warning}</li>)}
                    </ul>
                  ) : <div className="border-t border-border py-4 text-sm text-muted-foreground">No warnings for this file.</div>}
                </TabsContent>
              </Tabs>
            </section>

            <section aria-labelledby="preview-heading" className="border-t border-border pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="preview-heading" className="text-lg font-semibold">Data preview</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Showing up to the first 50 rows.</p>
                </div>
                <Tabs value={previewMode} onValueChange={value => setPreviewMode(value as PreviewMode)}>
                  <TabsList>
                    <TabsTrigger value="raw">Raw Data</TabsTrigger>
                    <TabsTrigger value="cleaned">Cleaned Data</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="max-h-[420px] overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>{(previewMode === 'raw' ? rawColumns : columns).map(column => <TableHead key={column} className="whitespace-nowrap">{column}</TableHead>)}</TableRow>
                  </TableHeader>
                  <TableBody>
                    {(previewMode === 'raw' ? result.rawRows : result.cleanedRows).slice(0, 50).map((row, rowIndex) => (
                      <TableRow key={`preview-${rowIndex}`}>
                        {(previewMode === 'raw' ? rawColumns : columns).map(column => {
                          const sourceRow = result.rawRows[(row as Record<symbol, number>)[SOURCE_INDEX] ?? rowIndex];
                          const changed = previewMode === 'cleaned' && !sameValue(sourceRow?.[result.columnSource?.[column] ?? column], row[column]);
                          return <TableCell key={`${rowIndex}-${column}`} className={`max-w-64 truncate whitespace-nowrap ${changed ? 'bg-warning/20 text-foreground' : ''}`}>{printable(row[column])}</TableCell>;
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section aria-labelledby="schema-heading" className="border-t border-border pt-5">
              <div className="mb-3">
                <h2 id="schema-heading" className="text-lg font-semibold">Schema</h2>
                <p className="mt-1 text-sm text-muted-foreground">Columns and values found in this file.</p>
              </div>
              <div className="overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader><TableRow><TableHead>Column</TableHead><TableHead>SQL type</TableHead><TableHead>Nulls</TableHead><TableHead>Unique</TableHead><TableHead>Min / max</TableHead><TableHead>Samples</TableHead></TableRow></TableHeader>
                  <TableBody>{result.schema.map(column => (
                    <TableRow key={`schema-${column.name}`}>
                      <TableCell className="font-medium">{column.name}</TableCell>
                      <TableCell>{column.sqlType}</TableCell>
                      <TableCell>{column.nullCount}</TableCell>
                      <TableCell>{column.uniqueCount}</TableCell>
                      <TableCell className="whitespace-nowrap">{schemaTableValue(column)}</TableCell>
                      <TableCell className="max-w-64 truncate">{column.samples.map(printable).join(', ') || '—'}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
              <div className="mt-3 flex flex-wrap items-start gap-3">
                <Textarea aria-label="Plain text schema" readOnly value={result.schemaText} className="min-h-28 flex-1 font-mono text-xs" />
                <Button type="button" variant="outline" onClick={() => void copySchema()}>
                  {copied ? <Check /> : <Clipboard />}{copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </section>

            <section className="flex flex-col justify-between gap-3 border-t border-border py-5 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-base font-semibold">Ready to continue?</h2>
                <p className="mt-1 text-sm text-muted-foreground">Download this file or make it available to your chat.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={downloadCleaned}><FileSpreadsheet /> Download Cleaned CSV</Button>
                <Button type="button" onClick={useForChat}><Sparkles /> Use this data for chat</Button>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function ReportTable({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <div className="border-t border-border py-4 text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="overflow-auto rounded-md border border-border">
      <Table>
        <TableHeader><TableRow>{headers.map(header => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{rows.map((row, rowIndex) => <TableRow key={`report-${rowIndex}`}>{row.map((value, cellIndex) => <TableCell key={`report-${rowIndex}-${cellIndex}`}>{value}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
  );
}