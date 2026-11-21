import {Chart, type ChartData} from '@gravity-ui/charts'
import {Card, Text} from '@gravity-ui/uikit'
import {useMemo} from 'react'
import type {AlertGroup, IncidentStatus, Priority} from './types'
import './OnCallCharts.css'

interface OnCallChartsProps {
  incidents: AlertGroup[]
}

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4']
const PRIORITY_COLORS = [
  'var(--g-color-base-danger-heavy)',
  'var(--g-color-base-warning-heavy)',
  'var(--g-color-base-info-heavy)',
  'var(--g-color-base-neutral-heavy)',
]

const STATUS_ORDER: IncidentStatus[] = [
  'new',
  'assigned',
  'in_progress',
  'research',
  'resolved',
  'closed',
]

const STATUS_LABELS: Record<IncidentStatus, string> = {
  new: 'Новый',
  assigned: 'Назначен',
  in_progress: 'В работе',
  research: 'Исследование',
  resolved: 'Решён',
  closed: 'Закрыт',
}

const STATUS_COLORS = [
  'var(--g-color-base-info-heavy)',
  'var(--g-color-base-warning-heavy)',
  'var(--g-color-base-info-heavy)',
  'var(--g-color-base-neutral-heavy)',
  'var(--g-color-base-positive-heavy)',
  'var(--g-color-base-neutral-heavy)',
]

function countByPriority(incidents: AlertGroup[]): number[] {
  return PRIORITIES.map(
    (priority) => incidents.filter((item) => item.priority === priority).length,
  )
}

function countByStatus(incidents: AlertGroup[]): number[] {
  return STATUS_ORDER.map(
    (status) => incidents.filter((item) => item.status === status).length,
  )
}

export function OnCallCharts({incidents}: OnCallChartsProps) {
  const priorityData: ChartData = useMemo(() => {
    const counts = countByPriority(incidents)

    return {
      xAxis: {type: 'category', categories: PRIORITIES},
      yAxis: [{min: 0}],
      legend: {enabled: false},
      series: {
        data: [
          {
            type: 'bar-x',
            name: 'Инциденты',
            dataLabels: {enabled: true},
            data: PRIORITIES.map((_priority, x) => ({
              x,
              y: counts[x],
              color: PRIORITY_COLORS[x],
            })),
          },
        ],
      },
    }
  }, [incidents])

  const statusData: ChartData = useMemo(() => {
    const counts = countByStatus(incidents)

    return {
      xAxis: {
        type: 'category',
        categories: STATUS_ORDER.map((status) => STATUS_LABELS[status]),
      },
      yAxis: [{min: 0}],
      legend: {enabled: false},
      series: {
        data: [
          {
            type: 'bar-x',
            name: 'Инциденты',
            dataLabels: {enabled: true},
            data: STATUS_ORDER.map((_status, x) => ({
              x,
              y: counts[x],
              color: STATUS_COLORS[x],
            })),
          },
        ],
      },
    }
  }, [incidents])

  const trendData: ChartData = useMemo(() => {
    const bins = new Map<string, {total: number; critical: number}>()

    for (const incident of incidents) {
      const date = new Date(incident.createdAt)
      const label = `${String(date.getHours()).padStart(2, '0')}:00`
      const bin = bins.get(label) ?? {total: 0, critical: 0}
      bin.total += 1
      if (incident.priority === 'P1') {
        bin.critical += 1
      }
      bins.set(label, bin)
    }

    const labels = [...bins.keys()].sort()

    return {
      xAxis: {type: 'category', categories: labels},
      yAxis: [{min: 0}],
      legend: {enabled: true},
      series: {
        data: [
          {
            type: 'line',
            name: 'Все инциденты',
            color: 'var(--g-color-base-info-heavy)',
            data: labels.map((label, x) => ({
              x,
              y: bins.get(label)?.total ?? 0,
            })),
          },
          {
            type: 'line',
            name: 'Критические',
            color: 'var(--g-color-base-danger-heavy)',
            data: labels.map((label, x) => ({
              x,
              y: bins.get(label)?.critical ?? 0,
            })),
          },
        ],
      },
    }
  }, [incidents])

  const trendLabel = incidents.length
    ? `с ${new Date(incidents[incidents.length - 1].createdAt).toLocaleTimeString(
        'ru-RU',
        {hour: '2-digit', minute: '2-digit'},
      )}`
    : 'нет данных'

  return (
    <div className="oncall-charts">
      <Card view="outlined" className="oncall-chart oncall-chart_wide">
        <div className="oncall-chart__header">
          <Text variant="subheader-2" as="h2">
            Динамика появления
          </Text>
          <Text variant="caption-2" color="secondary">
            {trendLabel}
          </Text>
        </div>
        <div
          className="oncall-chart__plot"
          role="img"
          aria-label="Динамика появления инцидентов по часам"
        >
          <Chart data={trendData} />
        </div>
      </Card>

      <Card view="outlined" className="oncall-chart">
        <div className="oncall-chart__header">
          <Text variant="subheader-2" as="h2">
            По приоритетам
          </Text>
          <Text variant="caption-2" color="secondary">
            P1–P4
          </Text>
        </div>
        <div
          className="oncall-chart__plot"
          role="img"
          aria-label="Количество инцидентов по приоритетам"
        >
          <Chart data={priorityData} />
        </div>
      </Card>

      <Card view="outlined" className="oncall-chart">
        <div className="oncall-chart__header">
          <Text variant="subheader-2" as="h2">
            По статусам
          </Text>
          <Text variant="caption-2" color="secondary">
            текущий срез
          </Text>
        </div>
        <div
          className="oncall-chart__plot"
          role="img"
          aria-label="Количество инцидентов по статусам"
        >
          <Chart data={statusData} />
        </div>
      </Card>
    </div>
  )
}
