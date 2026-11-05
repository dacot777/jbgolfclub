import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
} from 'recharts'
import { daily, monthlyDaily } from '@/lib/demo'
import { number } from '@/lib/report'

export function WeeklyChart({ metric }: { metric: 'spend' | 'clicks' }) {
  const money = metric === 'spend'
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <ComposedChart
        data={daily}
        margin={{ top: 10, right: 14, bottom: 0, left: -16 }}
        accessibilityLayer
      >
        <defs>
          <linearGradient id="weekly-fill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--chart-current)"
              stopOpacity={0.14}
            />
            <stop
              offset="100%"
              stopColor="var(--chart-current)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="3 4"
        />
        <XAxis
          dataKey="day"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          dy={8}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          tickFormatter={(v) => (money ? `${v / 10000}만` : number(v))}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 10,
            border: '1px solid var(--border)',
            fontSize: 12,
          }}
          formatter={(v, name) => [
            `${number(Number(v))}${money ? '원' : '회'}`,
            name,
          ]}
          labelFormatter={(v) => `${v}요일 · 같은 집계 시점`}
        />
        <Line
          type="monotone"
          name="지난주"
          dataKey={money ? 'beforeSpend' : 'beforeClicks'}
          stroke="var(--chart-previous)"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={{ r: 3, strokeWidth: 0 }}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          name="이번 주"
          dataKey={metric}
          stroke="var(--chart-current)"
          strokeWidth={2.5}
          fill="url(#weekly-fill)"
          dot={{ r: 4, strokeWidth: 3, stroke: 'var(--card)' }}
          activeDot={{ r: 6 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function MonthlyChart() {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <ComposedChart
        data={monthlyDaily}
        margin={{ top: 8, right: -19, bottom: 0, left: -21 }}
        accessibilityLayer
      >
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="3 4"
        />
        <XAxis
          dataKey="day"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          dy={5}
        />
        <YAxis
          yAxisId="spend"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
          tickFormatter={(v) => `${v / 10000}만`}
        />
        <YAxis
          yAxisId="results"
          orientation="right"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 10,
            border: '1px solid var(--border)',
            fontSize: 12,
          }}
          formatter={(v, name) => [
            `${number(Number(v))}${name === '광고비' ? '원' : '회'}`,
            name,
          ]}
        />
        <Bar
          yAxisId="spend"
          dataKey="spend"
          name="광고비"
          fill="var(--chart-bar)"
          radius={[4, 4, 0, 0]}
          maxBarSize={26}
          isAnimationActive={false}
        />
        <Line
          yAxisId="results"
          dataKey="results"
          name="랜딩 페이지 조회"
          type="monotone"
          stroke="var(--chart-current)"
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
