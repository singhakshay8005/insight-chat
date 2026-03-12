import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChartConfig } from '@/lib/queryProcessor';

interface DownloadButtonProps {
  charts: ChartConfig[];
}

export function DownloadButton({ charts }: DownloadButtonProps) {
  const handleDownload = () => {
    const lines: string[] = [];

    charts.forEach((chart) => {
      lines.push(`# ${chart.title}`);
      lines.push(`Chart Type: ${chart.type}`);
      lines.push('');

      if (chart.data.length === 0) return;

      const headers = Object.keys(chart.data[0]);
      lines.push(headers.join(','));
      chart.data.forEach((row) => {
        lines.push(headers.map((h) => {
          const val = row[h];
          const str = String(val ?? '');
          return str.includes(',') ? `"${str}"` : str;
        }).join(','));
      });
      lines.push('');
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `insights-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleDownload} className="gap-2">
      <Download className="w-4 h-4" />
      Download CSV
    </Button>
  );
}
