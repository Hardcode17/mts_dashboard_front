import {useEffect, useMemo, useRef, type ReactNode} from 'react'
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import {Card, Text, useViewportSize} from '@gravity-ui/uikit'
import type {MonitoringCoordinatorLoad, MonitoringPriority, MonitoringSummary, MonitoringTimelinePoint} from './summary.ts'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  DoughnutController,
  ArcElement,
  BarController,
  BarElement,
  Tooltip,
  Legend,
)

const numberFormat = new Intl.NumberFormat('ru-RU')
const tickFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
})
const priorityNames = new Map([
  [4, 'Критические'],
  [3, 'Высокий'],
  [2, 'Средний'],
  [1, 'Низкий'],
])
const MAX_COORDINATOR_BARS = 10

function resizeWithContainer(chart: Chart, container: HTMLElement): () => void {
  const resize = () => {
    if (chart.canvas && container.isConnected) chart.resize()
  }
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', resize)
    chart.resize()
    return () => {
      window.removeEventListener('resize', resize)
      chart.destroy()
    }
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  chart.resize()
  return () => {
    observer.disconnect()
    chart.destroy()
  }
}

interface ChartColors {
  critical: string
  high: string
  coordinators: string
  research: string
  priorityMedium: string
  priorityLow: string
  grid: string
  text: string
  surface: string
}

function readColors(element: HTMLElement): ChartColors {
  const styles = getComputedStyle(element)
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  const text = token('--g-color-text-primary', styles.color)
  const muted = token('--g-color-text-secondary', text)
  return {
    critical: token('--g-color-text-danger', text),
    high: token('--g-color-text-warning', text),
    coordinators: token('--g-color-text-info', text),
    research: token('--g-color-text-positive', text),
    priorityMedium: token('--g-color-text-info', text),
    priorityLow: muted,
    grid: token('--g-color-line-generic', muted),
    text: muted,
    surface: token('--g-color-base-float', styles.backgroundColor || text),
  }
}

function readFontFamily(element: HTMLElement): string {
  const styles = getComputedStyle(element)
  return styles.getPropertyValue('--g-font-family-sans').trim() || styles.fontFamily
}

function priorityLabel(priorityId: number): string {
  return priorityNames.get(priorityId) ?? `P${priorityId}`
}

function shortName(name: string, limit = 34): string {
  return name.length > limit ? name.slice(0, limit - 1) + '…' : name
}

function tooltipStyle(colors: ChartColors, family: string, size: number) {
  return {
    backgroundColor: colors.surface,
    titleColor: colors.text,
    bodyColor: colors.text,
    borderColor: colors.grid,
    borderWidth: 1,
    padding: 12,
    titleFont: {family, size},
    bodyFont: {family, size},
  }
}

function legendStyle(colors: ChartColors, size: number, family: string, position: 'bottom' | 'right' = 'bottom') {
  return {
    position,
    labels: {
      color: colors.text,
      boxWidth: 10,
      boxHeight: 10,
      padding: 18,
      usePointStyle: true,
      pointStyle: 'circle' as const,
      font: {size, family},
    },
  }
}

function ChartCard({title, description, className, children}: {
  title: string
  description: string
  className?: string
  children: ReactNode
}) {
  return <Card view="outlined" className={'monitor-chart-card' + (className ? ' ' + className : '')}>
    <div className="monitor-chart-heading">
      <Text as="h2" variant="header-1">{title}</Text>
      <Text as="p" color="secondary" variant="body-2">{description}</Text>
    </div>
    {children}
  </Card>
}

function EmptyChart({message}: {message: string}) {
  return <div className="monitor-chart-empty">
    <Text color="secondary" variant="subheader-2">{message}</Text>
  </div>
}

function chartFontSize(width: number | undefined): number {
  if (width === undefined) return 16
  if (width >= 1600) return 20
  if (width >= 1100) return 16
  return 13
}

function TimelineChart({timeline, theme, reducedMotion, fontSize}: {
  timeline: MonitoringTimelinePoint[]
  theme: 'light' | 'dark'
  reducedMotion: boolean
  fontSize: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const colors = readColors(element)
    const family = readFontFamily(element)
    const chart = new Chart(element, {
      type: 'line',
      data: {
        labels: timeline.map((point) => tickFormat.format(new Date(point.at))),
        datasets: [
          {label: 'Критические', data: timeline.map((point) => point.critical), borderColor: colors.critical, backgroundColor: colors.critical},
          {label: 'Высокий приоритет', data: timeline.map((point) => point.high), borderColor: colors.high, backgroundColor: colors.high},
          {label: 'На координаторах', data: timeline.map((point) => point.coordinators), borderColor: colors.coordinators, backgroundColor: colors.coordinators},
          {label: 'Исследование ситуации', data: timeline.map((point) => point.research), borderColor: colors.research, backgroundColor: colors.research},
        ].map((dataset) => ({
          ...dataset,
          borderWidth: 3,
          pointRadius: timeline.length > 2 ? 2 : 5,
          pointHoverRadius: 7,
          pointBackgroundColor: dataset.backgroundColor,
          pointBorderColor: dataset.backgroundColor,
          tension: 0.2,
          spanGaps: false,
        })),
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: reducedMotion ? false : {duration: 300},
        interaction: {mode: 'index', intersect: false},
        plugins: {
          legend: legendStyle(colors, fontSize, family),
          tooltip: tooltipStyle(colors, family, fontSize),
        },
        scales: {
          x: {
            grid: {display: false},
            border: {display: false},
            ticks: {
              color: colors.text,
              autoSkip: true,
              maxRotation: 0,
              maxTicksLimit: fontSize >= 20 ? 10 : 7,
              font: {size: fontSize, family},
            },
          },
          y: {
            beginAtZero: true,
            grid: {color: colors.grid},
            border: {display: false},
            ticks: {color: colors.text, precision: 0, font: {size: fontSize, family}},
          },
        },
      },
    })
    return resizeWithContainer(chart, element.parentElement ?? element)
  }, [timeline, theme, reducedMotion, fontSize])

  return <>
    <div className="monitor-chart-plot">
      <canvas ref={canvas} role="img" aria-label={`Динамика по четырём категориям за 24 часа, точек: ${timeline.length}`} />
    </div>
    <div className="monitor-sr">
      <table>
        <caption>Динамика по категориям за 24 часа</caption>
        <thead><tr><th>Время, МСК</th><th>Критические</th><th>Высокий приоритет</th><th>На координаторах</th><th>Исследование ситуации</th></tr></thead>
        <tbody>{timeline.map((point, index) => <tr key={point.at + '-' + index}>
          <th scope="row">{tickFormat.format(new Date(point.at))}</th>
          <td>{point.critical}</td><td>{point.high}</td><td>{point.coordinators}</td><td>{point.research}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </>
}

function PriorityChart({priorities, theme, reducedMotion, fontSize, legendPosition}: {
  priorities: MonitoringPriority[]
  theme: 'light' | 'dark'
  reducedMotion: boolean
  fontSize: number
  legendPosition: 'bottom' | 'right'
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const ordered = useMemo(
    () => [...priorities].sort((first, second) => second.priorityId - first.priorityId),
    [priorities],
  )
  useEffect(() => {
    const element = canvas.current
    if (!element || !ordered.length) return
    const colors = readColors(element)
    const family = readFontFamily(element)
    const chart = new Chart(element, {
      type: 'doughnut',
      data: {
        labels: ordered.map((item) => `${priorityLabel(item.priorityId)} · ${numberFormat.format(item.count)}`),
        datasets: [{
          data: ordered.map((item) => item.count),
          backgroundColor: ordered.map((item) =>
            item.priorityId === 4 ? colors.critical
              : item.priorityId === 3 ? colors.high
                : item.priorityId === 2 ? colors.priorityMedium
                  : colors.priorityLow),
          borderColor: colors.surface,
          borderWidth: 2,
          hoverOffset: 0,
        }],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        cutout: '60%',
        animation: reducedMotion ? false : {duration: 300},
        plugins: {
          legend: legendStyle(colors, fontSize, family, legendPosition),
          tooltip: tooltipStyle(colors, family, fontSize),
        },
      },
    })
    return resizeWithContainer(chart, element.parentElement ?? element)
  }, [ordered, theme, reducedMotion, fontSize, legendPosition])

  return <>
    <div className="monitor-chart-plot">
      <canvas ref={canvas} role="img" aria-label={`Распределение активных инцидентов по приоритетам, групп: ${ordered.length}`} />
    </div>
    <div className="monitor-sr">
      <table>
        <caption>Распределение по приоритетам</caption>
        <thead><tr><th>Приоритет</th><th>Количество</th></tr></thead>
        <tbody>{ordered.map((item, index) => <tr key={item.priorityId + '-' + index}><th scope="row">{priorityLabel(item.priorityId)}</th><td>{item.count}</td></tr>)}</tbody>
      </table>
    </div>
  </>
}

function CoordinatorChart({load, theme, reducedMotion, fontSize}: {
  load: MonitoringCoordinatorLoad[]
  theme: 'light' | 'dark'
  reducedMotion: boolean
  fontSize: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const rows = useMemo(
    () => [...load].sort((first, second) => second.count - first.count).slice(0, MAX_COORDINATOR_BARS),
    [load],
  )
  useEffect(() => {
    const element = canvas.current
    if (!element || !rows.length) return
    const colors = readColors(element)
    const family = readFontFamily(element)
    const chart = new Chart(element, {
      type: 'bar',
      data: {
        labels: rows.map((item) => shortName(item.name)),
        datasets: [{
          label: 'Инцидентов на координаторе',
          data: rows.map((item) => item.count),
          backgroundColor: colors.coordinators,
          borderColor: colors.coordinators,
          borderWidth: 0,
          borderRadius: 3,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        maintainAspectRatio: false,
        animation: reducedMotion ? false : {duration: 300},
        plugins: {
          legend: {display: false},
          tooltip: tooltipStyle(colors, family, fontSize),
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: {color: colors.grid},
            border: {display: false},
            ticks: {color: colors.text, precision: 0, font: {size: fontSize, family}},
          },
          y: {
            grid: {display: false},
            border: {display: false},
            ticks: {color: colors.text, font: {size: fontSize, family}},
          },
        },
      },
    })
    return resizeWithContainer(chart, element.parentElement ?? element)
  }, [rows, theme, reducedMotion, fontSize])

  return <>
    <div className="monitor-chart-plot">
      <canvas ref={canvas} role="img" aria-label={`Нагрузка на координаторов, человек: ${rows.length}`} />
    </div>
    <div className="monitor-sr">
      <table>
        <caption>Нагрузка на координаторов</caption>
        <thead><tr><th>Координатор</th><th>Инцидентов</th></tr></thead>
        <tbody>{load.map((item, index) => <tr key={item.name + '-' + index}><th scope="row">{item.name}</th><td>{item.count}</td></tr>)}</tbody>
      </table>
    </div>
  </>
}

export function MonitoringCharts({summary, theme, reducedMotion}: {
  summary: MonitoringSummary
  theme: 'light' | 'dark'
  reducedMotion: boolean
}) {
  const {width} = useViewportSize()
  const fontSize = chartFontSize(width)
  const doughnutLegend = width !== undefined && width >= 1200 ? 'right' : 'bottom'
  const timelineDescription = summary.timeline.length
    ? `Последние ${summary.timeline.length} наблюдений · категории могут пересекаться`
    : 'Наблюдений за 24 часа нет'
  const priorityTotal = summary.priorities.reduce((total, item) => total + item.count, 0)
  const coordinatorTotal = summary.coordinatorLoad.length
  const coordinatorDescription = coordinatorTotal > MAX_COORDINATOR_BARS
    ? `Показаны ${MAX_COORDINATOR_BARS} из ${coordinatorTotal} по нагрузке`
    : 'Активные инциденты на координаторах'

  return <div className="monitor-charts">
    <ChartCard title="Динамика за 24 часа" description={timelineDescription} className="monitor-chart-wide">
      {summary.timeline.length
        ? <TimelineChart timeline={summary.timeline} theme={theme} reducedMotion={reducedMotion} fontSize={fontSize} />
        : <EmptyChart message="История наблюдений пока не передана." />}
    </ChartCard>
    <ChartCard title="Распределение по приоритетам" description={summary.priorities.length ? `Всего ${numberFormat.format(priorityTotal)}` : 'Нет данных о приоритетах'}>
      {summary.priorities.length
        ? <PriorityChart priorities={summary.priorities} theme={theme} reducedMotion={reducedMotion} fontSize={fontSize} legendPosition={doughnutLegend} />
        : <EmptyChart message="Распределение по приоритетам не передано." />}
    </ChartCard>
    <ChartCard title="Нагрузка на координаторов" description={coordinatorDescription}>
      {summary.coordinatorLoad.length
        ? <CoordinatorChart load={summary.coordinatorLoad} theme={theme} reducedMotion={reducedMotion} fontSize={fontSize} />
        : <EmptyChart message="Нагрузка на координаторов не передана." />}
    </ChartCard>
  </div>
}
