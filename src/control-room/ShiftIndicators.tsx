import {useMemo} from 'react'
import {Chart, type ChartData} from '@gravity-ui/charts'
import type {Incident} from '../demoData'

interface Props {
  count: number
  entered: number
  exited: number
  trend: number[]
  ins: number[]
  outs: number[]
  next?: Incident
  minutes: number | null
  at: (second: number, seconds?: boolean) => string
  incidentHref: (item: Incident) => string
}

function Trend({values}: {values: number[]}) {
  const data = useMemo<ChartData>(
    () => ({
      xAxis: {min: 0, max: 60, visible: false},
      yAxis: [{min: Math.max(0, Math.min(...values) - 1), max: Math.max(...values) + 1, visible: false}],
      legend: {enabled: false},
      series: {
        data: [
          {
            type: 'line',
            name: 'Активные критические',
            color: 'var(--cr-blue)',
            lineWidth: 2,
            interpolation: {type: 'monotone'},
            data: values.map((y, x) => ({x, y})),
          },
        ],
      },
    }),
    [values],
  )
  return (
    <div
      className="cr-trend"
      role="img"
      aria-label={'Критические за минуту: от ' + Math.min(...values) + ' до ' + Math.max(...values)}
    >
      <Chart data={data} />
    </div>
  )
}

function MinuteChart({
  ins,
  outs,
  at,
  entered,
  exited,
}: Pick<Props, 'ins' | 'outs' | 'at' | 'entered' | 'exited'>) {
  const bins = Array.from({length: 12}, (_, i) => ({
    at: at(i * 5),
    incoming: ins.slice(i * 5, i * 5 + 5).reduce((a, b) => a + b, 0),
    outgoing: outs.slice(i * 5, i * 5 + 5).reduce((a, b) => a + b, 0),
  }))
  const peak = Math.max(1, ...bins.map((bin) => Math.max(bin.incoming, bin.outgoing)))
  return (
    <div className="cr-bars" role="img" aria-label={'Вошли ' + entered + ', вышли ' + exited + ' за минуту'}>
      {bins.map((bin) => (
        <span
          className="cr-bar-pair"
          key={bin.at}
          title={bin.at + ' · вошли ' + bin.incoming + ', вышли ' + bin.outgoing}
        >
          <i style={{height: (100 * bin.incoming) / peak + '%'}} />
          <i style={{height: (100 * bin.outgoing) / peak + '%'}} />
        </span>
      ))}
    </div>
  )
}
export function ShiftIndicators({
  count,
  entered,
  exited,
  trend,
  ins,
  outs,
  next,
  minutes,
  at,
  incidentHref,
}: Props) {
  return (
    <div className="cr-kpis" data-overview-block="stats">
      <section className="cr-panel cr-critical">
        <h2>Критические сейчас</h2>
        <div className="cr-score">
          <strong>{count}</strong>
          <Trend values={trend} />
        </div>
        <div className="cr-moves">
          <div>
            <b>+{entered}</b>
            <span>Добавилось за минуту</span>
          </div>
          <div>
            <b>−{exited}</b>
            <span>Выбыло за минуту</span>
          </div>
        </div>
      </section>
      <section className="cr-panel cr-nearest">
        <h2>{minutes !== null && minutes < 0 ? 'Просроченный критический' : 'Ближайший срок'}</h2>
        {next ? (
          <>
            <div className="cr-deadline">
              <strong>{Math.abs(minutes ?? 0)}</strong>
              <span>{(minutes ?? 0) < 0 ? 'мин просрочки' : 'мин до срока'}</span>
              <time>{next.due} МСК</time>
            </div>
            <a href={incidentHref(next)} className="cr-next-title">
              {next.title} ↗
            </a>
            <div className="cr-next-meta">
              {next.product} <span>·</span>{' '}
              {
                <a className="cr-number" href={incidentHref(next)}>
                  {next.id}
                </a>
              }
            </div>
          </>
        ) : (
          <p className="cr-muted">Критических с известным сроком нет</p>
        )}
      </section>
      <section className="cr-panel cr-flow">
        <h2>
          Поток критических <span>60 сек</span>
        </h2>
        <div className="cr-flow-body">
          <div className="cr-flow-total">
            {entered + exited}
            <small>переходов</small>
          </div>
          {entered + exited ? (
            <MinuteChart ins={ins} outs={outs} at={at} entered={entered} exited={exited} />
          ) : (
            <span className="cr-quiet">За минуту переходов не было</span>
          )}
        </div>
        <div className="cr-legend">
          <span>Добавились</span>
          <span>Выбыли</span>
          <time>
            {at(0, false)}–{at(60, false)}
          </time>
        </div>
      </section>
    </div>
  )
}
