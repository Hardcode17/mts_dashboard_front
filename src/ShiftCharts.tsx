import {useMemo, useState} from 'react'
import {Chart, type ChartData} from '@gravity-ui/charts'
import {Card, Flex, Link, SegmentedRadioGroup, Text} from '@gravity-ui/uikit'
import {snapshotTime, type Incident} from './demoData'
import {deadlineDistribution, incidentTrend, type TrendPeriod} from './shiftMetrics'
import './ShiftCharts.css'

const colors = {
  incoming: 'var(--g-color-text-info)',
  restored: 'var(--g-color-text-positive)',
  critical: 'var(--g-color-text-danger)',
  warning: 'var(--g-color-text-warning)',
  neutral: 'var(--g-color-text-secondary)',
}

export function ShiftCharts({incidents, critical}: {incidents: Incident[]; critical: Incident[]}) {
  const [period, setPeriod] = useState<TrendPeriod>('shift')
  const trend = useMemo(() => incidentTrend(incidents, snapshotTime, period), [incidents, period])
  const distribution = useMemo(() => deadlineDistribution(critical, snapshotTime), [critical])
  const trendData: ChartData = {
    xAxis: {type: 'category', categories: trend.map(bin => bin.label)},
    yAxis: [{min: 0}],
    legend: {enabled: true},
    series: {data: [
      {type: 'line', name: 'Зарегистрировано', color: colors.incoming, data: trend.map((bin, x) => ({x, y: bin.registered}))},
      {type: 'line', name: 'Восстановлено', color: colors.restored, data: trend.map((bin, x) => ({x, y: bin.restored}))},
    ]},
  }
  const barColors = [colors.critical, colors.warning, colors.incoming, colors.incoming, colors.incoming, colors.neutral]
  const deadlinesData: ChartData = {
    xAxis: {type: 'category', categories: distribution.map(bin => bin.label)},
    yAxis: [{min: 0}],
    legend: {enabled: false},
    series: {data: [{type: 'bar-x', name: 'Критические инциденты',
      dataLabels: {enabled: true},
      data: distribution.map((bin, x) => ({x, y: bin.value, color: barColors[x]})),
    }]},
  }
  return <div className="shift-charts">
    <Card view="outlined" className="mcc-glass shift-chart">
      <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap>
        <Text as="h2" variant="header-1">Динамика инцидентов</Text>
        <SegmentedRadioGroup<TrendPeriod> aria-label="Период динамики" size="s" value={period} onUpdate={setPeriod}>
          <SegmentedRadioGroup.Option value="shift">Смена</SegmentedRadioGroup.Option>
          <SegmentedRadioGroup.Option value="hour">Час</SegmentedRadioGroup.Option>
        </SegmentedRadioGroup>
      </Flex>
      <Text variant="body-1" color="secondary">{trend[0].label}–{snapshotTime} МСК · число инцидентов за {period === 'shift' ? 30 : 10} мин</Text>
      <div className="shift-chart-plot" role="img" aria-label={trend.map(bin => bin.label + ': регистраций ' + bin.registered + ', восстановлений ' + bin.restored).join('; ')}>
        <Chart data={trendData} />
      </div>
    </Card>
    <Card view="outlined" className="mcc-glass shift-chart">
      <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap>
        <Text as="h2" variant="header-1">Сроки критических</Text>
        <Link href="#queue/critical?sla=soon">До 30 мин: {distribution[1].value} →</Link>
      </Flex>
      <Text variant="body-1" color="secondary">Остаток до срока решения · на {snapshotTime} МСК</Text>
      <div className="shift-chart-plot" role="img" aria-label={distribution.map(bin => bin.label + ': ' + bin.value).join('; ')}>
        <Chart data={deadlinesData} />
      </div>
    </Card>
  </div>
}
