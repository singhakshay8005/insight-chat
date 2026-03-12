import { motion } from 'framer-motion';
import { DashboardChart } from './DashboardChart';
import type { ChartConfig } from '@/lib/queryProcessor';

interface DashboardProps {
  charts: ChartConfig[];
}

export function Dashboard({ charts }: DashboardProps) {
  if (charts.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      <div className={`grid gap-4 ${charts.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
        {charts.map((chart, i) => (
          <DashboardChart key={`${chart.title}-${i}`} config={chart} index={i} />
        ))}
      </div>
    </motion.div>
  );
}
