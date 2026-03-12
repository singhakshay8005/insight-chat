import { motion } from 'framer-motion';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import type { ChartConfig } from '@/lib/queryProcessor';

const CHART_COLORS = [
  'hsl(174, 72%, 50%)',
  'hsl(262, 60%, 60%)',
  'hsl(32, 90%, 55%)',
  'hsl(340, 65%, 55%)',
  'hsl(200, 70%, 55%)',
  'hsl(140, 60%, 50%)',
];

interface DashboardChartProps {
  config: ChartConfig;
  index: number;
}

export function DashboardChart({ config, index }: DashboardChartProps) {
  const { type, title, x_axis, y_axis, data } = config;

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: 'hsl(220, 18%, 10%)',
      border: '1px solid hsl(220, 14%, 18%)',
      borderRadius: '8px',
      fontSize: '12px',
      color: 'hsl(210, 20%, 92%)',
    },
  };

  const formatNumber = (val: unknown) => {
    const num = Number(val);
    if (isNaN(num)) return val;
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const renderChart = () => {
    switch (type) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis dataKey={x_axis} tick={{ fontSize: 11, fill: 'hsl(215, 12%, 50%)' }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(215, 12%, 50%)' }} tickFormatter={(v) => String(formatNumber(v))} />
              <Tooltip {...tooltipStyle} formatter={(v: unknown) => formatNumber(v)} />
              <Legend />
              <Line type="monotone" dataKey={y_axis} stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        );
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis dataKey={x_axis} tick={{ fontSize: 11, fill: 'hsl(215, 12%, 50%)' }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(215, 12%, 50%)' }} tickFormatter={(v) => String(formatNumber(v))} />
              <Tooltip {...tooltipStyle} formatter={(v: unknown) => formatNumber(v)} />
              <Legend />
              <Bar dataKey={y_axis} radius={[4, 4, 0, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={data}
                dataKey={y_axis}
                nameKey={x_axis}
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={{ stroke: 'hsl(215, 12%, 50%)' }}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} formatter={(v: unknown) => formatNumber(v)} />
            </PieChart>
          </ResponsiveContainer>
        );
      case 'area':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis dataKey={x_axis} tick={{ fontSize: 11, fill: 'hsl(215, 12%, 50%)' }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(215, 12%, 50%)' }} tickFormatter={(v) => String(formatNumber(v))} />
              <Tooltip {...tooltipStyle} formatter={(v: unknown) => formatNumber(v)} />
              <Legend />
              <Area type="monotone" dataKey={y_axis} stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        );
      default:
        return <p className="text-muted-foreground text-sm">Unsupported chart type: {type}</p>;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.1 }}
      className="bg-card border border-border rounded-xl p-5 card-shadow"
    >
      <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      {renderChart()}
    </motion.div>
  );
}
