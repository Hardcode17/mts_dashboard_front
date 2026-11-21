import {useMemo, useState} from 'react'
import {Chart, type ChartData} from '@gravity-ui/charts'
import {Button, Card, SegmentedRadioGroup, Text} from '@gravity-ui/uikit'
import type {Incident} from './demoData'
import {useWorkspace} from './desk/context'
import {followOverviewAnchor} from './desk/queueNavigation'
import {moscowTime, standNow} from './desk/types'
import {deadlineDistribution, incidentTrend, type TrendPeriod} from './shiftMetrics'
import './ShiftCharts.css'

const series = [
  {field: 'registered', name: 'Зарегистрировано', color: 'var(--g-color-text-info)'},
  {field: 'restored', name: 'Восстановлено', color: 'var(--g-color-text-positive)'},
] as const

export function ShiftCharts({incidents, critical, soonHref}: {incidents: Incident[]; critical: Incident[]; soonHref: string}) {
  const {desk, now} = useWorkspace()
  const epoch = Math.floor(standNow(desk, now) / 60000) * 60000
  const snapshotTime = moscowTime(epoch)
  const [period, setPeriod] = useState<TrendPeriod>('shift')
  const trend = useMemo(() => incidentTrend(incidents, snapshotTime, period, epoch), [incidents, period, snapshotTime, epoch])
  const distribution = useMemo(() => deadlineDistribution(critical, snapshotTime, epoch), [critical, snapshotTime, epoch])
  const trendData = useMemo<ChartData>(() => {
    const labels = trend.map(bin => bin.label)
    const count = Math.min(labels.length, 5)
    const ticks = Array.from({length: count}, (_, i) => Math.round(i * (labels.length - 1) / Math.max(count - 1, 1)))
    return {
      xAxis: {type: 'category', categories: labels, ticks: {values: ticks}, grid: {enabled: false}, lineVisible: false},
      yAxis: [{min: 0, ticks: {interval: 48}, lineVisible: false, grid: {dashStyle: 'ShortDash'}}],
      legend: {enabled: true, align: 'left'},
      series: {data: series.map(({field, name, color}) => ({
        type: 'line', name, color, lineWidth: 2.5, linecap: 'round', linejoin: 'round',
        interpolation: {type: 'monotone'},
        marker: {enabled: trend.length === 1},
        data: trend.map((bin, x) => ({x, y: bin[field]})),
      }))},
    }
  }, [trend])

  return <div className="shift-charts">
    <Card view="outlined" className="mcc-glass shift-chart">
      <div className="shift-chart-heading">
        <Text as="h2" variant="header-1">Динамика инцидентов</Text>
        <SegmentedRadioGroup<TrendPeriod> className="shift-chart-period" aria-label="Период динамики" size="m" value={period} onUpdate={setPeriod}>
          <SegmentedRadioGroup.Option value="shift">Смена</SegmentedRadioGroup.Option>
          <SegmentedRadioGroup.Option value="hour">Час</SegmentedRadioGroup.Option>
        </SegmentedRadioGroup>
      </div>
      <Text color="secondary">{trend[0].label}–{snapshotTime} МСК · интервалы по {period === 'shift' ? 30 : 10} мин</Text>
      <div className="shift-chart-plot" role="group" aria-label="Регистрации и восстановления по времени">
        {trend.some(bin => bin.registered || bin.restored) ? <>
          <Chart data={trendData} />
          <div className="chart-values-accessible"><table><caption>Значения по интервалам</caption>
            <thead><tr><th>Начало интервала, МСК</th><th>Зарегистрировано</th><th>Восстановлено</th></tr></thead>
            <tbody>{trend.map(bin=><tr key={bin.label}><th scope="row">{bin.label}</th><td>{bin.registered}</td><td>{bin.restored}</td></tr>)}</tbody>
          </table></div>
        </> : <Text className="shift-chart-empty" color="secondary">За этот период регистраций и восстановлений нет.</Text>}
      </div>
    </Card>

    <Card view="outlined" className="mcc-glass shift-chart">
      <div className="shift-chart-heading">
        <Text as="h2" variant="header-1">Сроки критических инцидентов</Text>
      </div>
      <Text color="secondary">По времени до срока решения · всего {critical.length.toLocaleString('ru-RU')}</Text>
      <div className="deadline-chart">
        <dl className="deadline-bands">
          {distribution.map(bin => <div className="deadline-band" key={bin.label}>
            <dt>{bin.label}</dt>
            <dd><span aria-hidden="true" className="deadline-track">
              <span style={{width: (critical.length ? 100 * bin.value / critical.length : 0) + '%'}} />
            </span><span>{bin.value.toLocaleString('ru-RU')}</span></dd>
          </div>)}
        </dl>
        <Button href={soonHref} onClick={e=>followOverviewAnchor(e, 'critical')} view="flat-secondary" size="s" className="deadline-queue-link">Инциденты со сроком до 30 мин →</Button>
      </div>
    </Card>
  </div>
}
