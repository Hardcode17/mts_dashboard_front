import {usesRealBackend} from './shared/api/mode'
import {workspaceFetch} from './auth/session'
import {useEffect, useId, useState} from 'react'
import {Button, Card, Checkbox, Select, TextInput, Flex, Label, Link, Text} from '@gravity-ui/uikit'
import type {Incident} from './demoData'
import {useWorkspace} from './desk/context'
import {coordinatorGroup, fullTime, standNow} from './desk/types'
import {measures, recoveryTrial} from './desk/recovery'
import {unknownTechnicalRecipient} from './agentDemo'
import {InvestigationAction} from './InvestigationAction'
import {investigationHref, isInvestigationReport} from './desk/analysisLinks'
import './AgentInvestigation.css'

function RecoveryExperiment({incident}: {incident: Incident}) {
  const {desk, refresh} = useWorkspace(),
    w = desk.work[incident.key]
  const [input, setInput] = useState('100')
  const loadId = useId()
  const [progress, setProgress] = useState<number | null>(null),
    [failure, setFailure] = useState('')
  async function probe() {
    const count = Number(input)
    async function request(data: Record<string, unknown>) {
      const r = await workspaceFetch('/api/stand/shop?mode=volume', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data),
      })
      const json = await r.json()
      if (!r.ok) throw Error(json.error)
      return json
    }
    setFailure('')
    setProgress(0)
    try {
      const {id} = await request({type: 'start', input: count})
      for (let leg = 0; leg < measures.length; leg++) {
        for (let first = 0; first < count; first += 10) {
          await Promise.all(
            Array.from({length: Math.min(10, count - first)}, (_, i) =>
              request({type: 'order', id, leg, order: first + i}),
            ),
          )
          setProgress(leg * count + Math.min(count, first + 10))
        }
      }
      await request({type: 'finish', id})
      await refresh()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Не удалось выполнить прогон')
    } finally {
      setProgress(null)
    }
  }
  const trials = measures.map((m) => recoveryTrial(w?.profile ?? 'database', m, Number(input)))
  const result = w?.reports.find((r) => r.title === 'Эксперимент восстановления')
  return (
    <Card className="mcc-glass incident-panel">
      <Text as="h2" variant="header-1">
        Сравнение мер восстановления
      </Text>
      <Text>
        Модель стенда пропускает уникальные заказы через обработчик и БД. Успех — подтверждение за 30 секунд.
      </Text>
      <div className="mcc-field agent-load-field">
        <label htmlFor={loadId}>Уникальных заказов в минуту</label>
        <TextInput
          id={loadId}
          size="l"
          type="number"
          value={input}
          onUpdate={setInput}
          controlProps={{min: 1, max: 500, step: 1}}
        />
      </div>
      <table className="incident-comparison">
        <caption>Прогноз своевременных оплат</caption>
        <thead>
          <tr>
            <th>Мера</th>
            <th>Заказов в срок</th>
            <th>Узкое место</th>
          </tr>
        </thead>
        <tbody>
          {trials.map((t) => (
            <tr key={t.measure}>
              <th>{t.measure}</th>
              <td>{t.expected || 0}</td>
              <td>{t.bottleneck}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        view="action"
        disabled={
          w?.telemetryOffline ||
          progress !== null ||
          !Number.isInteger(Number(input)) ||
          Number(input) < 1 ||
          Number(input) > 500
        }
        onClick={() => void probe()}
      >
        Запустить демопрогон
      </Button>
      {progress !== null && (
        <Text role="status">
          Подтверждений HTTP: {progress} / {Number(input) * 3}
        </Text>
      )}
      {failure && (
        <Text role="alert" color="danger">
          {failure}
        </Text>
      )}
      {result && (
        <p className="report-text" role="status">
          {result.content}
        </p>
      )}
    </Card>
  )
}

function Diagnostics({incident}: {incident: Incident}) {
  const {desk, act, busy} = useWorkspace()
  const w = desk.work[incident.key]
  const field = useId()
  const [interval, setIntervalValue] = useState(String(w?.dataInterval ?? 5))
  const [age, setAge] = useState(String(w?.lastRowAge ?? 2))
  const [object, setObject] = useState(w?.dataObject ?? 'payment_registry')
  const [missing, setMissing] = useState(!!w?.telemetryOffline)
  const [offline, setOffline] = useState(!!w?.modelOffline)
  const [profile, setProfile] = useState(w?.profile ?? 'database')

  return (
    <Card className="mcc-glass incident-panel agent-diagnostics">
      <form
        className="mcc-disclosure-body"
        onSubmit={async (event) => {
          event.preventDefault()
          await act({
            type: 'diagnostics',
            key: incident.key,
            number: Number(interval),
            age: Number(age),
            value: profile,
            title: object,
            enabled: missing,
            kind: offline ? 'offline' : 'online',
          })
        }}
      >
        <div className="agent-diagnostic-groups">
          <section className="agent-diagnostic-section" aria-labelledby={field + '-freshness'}>
            <Text as="h2" id={field + '-freshness'} variant="subheader-2">
              Свежесть данных
            </Text>
            <Text color="secondary">Сравниваем возраст последней записи с интервалом обновления.</Text>
            <div className="mcc-field">
              <label htmlFor={field + '-object'}>Таблица или индекс продукта</label>
              <TextInput
                id={field + '-object'}
                size="l"
                value={object}
                onUpdate={setObject}
                controlProps={{required: true}}
              />
            </div>
            <div className="agent-intervals">
              <div className="mcc-field">
                <label htmlFor={field + '-interval'}>Ожидаемый интервал, мин</label>
                <TextInput
                  id={field + '-interval'}
                  size="l"
                  type="number"
                  value={interval}
                  onUpdate={setIntervalValue}
                  controlProps={{required: true, min: 1, step: 1}}
                />
              </div>
              <div className="mcc-field">
                <label htmlFor={field + '-age'}>Возраст записи, мин</label>
                <TextInput
                  id={field + '-age'}
                  size="l"
                  type="number"
                  value={age}
                  onUpdate={setAge}
                  controlProps={{required: true, min: 0, step: 1}}
                />
              </div>
            </div>
          </section>
          <section className="agent-diagnostic-section" aria-labelledby={field + '-conditions'}>
            <Text as="h2" id={field + '-conditions'} variant="subheader-2">
              Состояние стенда
            </Text>
            {incident.key === 'incident' && (
              <div className="mcc-field">
                <label htmlFor={field + '-profile'}>Сценарий замедления</label>
                <Select
                  id={field + '-profile'}
                  width="max"
                  size="l"
                  value={[profile]}
                  options={[
                    {value: 'database', content: 'Ожидание БД'},
                    {value: 'workers', content: 'Насыщение обработчиков'},
                  ]}
                  onUpdate={([v]) => setProfile(v === 'workers' ? 'workers' : 'database')}
                />
              </div>
            )}
            <div className="agent-outages">
              <Checkbox checked={missing} onUpdate={setMissing}>
                Источник телеметрии недоступен
              </Checkbox>
              <Checkbox checked={offline} onUpdate={setOffline}>
                Модель недоступна
              </Checkbox>
            </div>
          </section>
        </div>
        <div className="agent-diagnostic-actions">
          <Button type="submit" size="l" view="outlined" disabled={busy}>
            Сохранить условия проверки
          </Button>
          {w?.diagnosticsAt && (
            <Text role="status" color="secondary">
              Последнее сохранение · {fullTime(standNow(desk, w.diagnosticsAt))} МСК
            </Text>
          )}
        </div>
      </form>
    </Card>
  )
}

export function AgentStandControls({incident}: {incident: Incident}) {
  const {desk} = useWorkspace()
  return (
    <section className="agent-run agent-stand" aria-label="Настройки разбора на стенде">
      <Link href={'#stand?incident=' + encodeURIComponent(incident.key)}>← К управлению стендом</Link>
      <header className="agent-run-heading">
        <Text as="h2" variant="header-2">
          Условия разбора ИИ
        </Text>
        <Text color="secondary">
          {incident.id} · {incident.title}
        </Text>
      </header>
      <Diagnostics key={incident.key} incident={incident} />
      <Link href={investigationHref(incident.key, desk.mode)}>К разбору ИИ</Link>
    </section>
  )
}

function PaymentPath({incident}: {incident: Incident}) {
  const {desk} = useWorkspace()
  const [node, setNode] = useState('Оплата')
  return (
    <Card className="mcc-glass incident-panel">
      <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap>
        <Text as="h2" variant="header-1">
          Путь заказа
        </Text>
        <Text color="secondary" variant="caption-2">
          {desk.work[incident.key]?.telemetryOffline ? 'Телеметрия недоступна' : 'Демозамер на 12:42 МСК'}
        </Text>
      </Flex>
      <ol className="incident-path">
        {['Оформление', 'Оплата', 'База данных'].map((n) => (
          <li key={n}>
            <Button size="s" view={n === node ? 'action' : 'outlined'} onClick={() => setNode(n)}>
              {n}
            </Button>
            <Text>
              {desk.work[incident.key]?.telemetryOffline
                ? 'Нет свежих измерений'
                : n === 'Оформление'
                  ? '100 заказов/мин'
                  : n === 'Оплата'
                    ? '82 из 100 в срок'
                    : desk.work[incident.key]?.profile === 'workers'
                      ? 'Ожидание БД невелико'
                      : 'Ожидание соединения'}
            </Text>
          </li>
        ))}
      </ol>
      <Text>
        <strong>{node}</strong> · Владелец:{' '}
        {node === 'База данных' ? 'Платформа БД' : node === 'Оплата' ? 'Команда платежей' : 'Команда заказов'}{' '}
        · дежурный по каталогу:{' '}
        {node === 'База данных' ? 'Мария Б.' : node === 'Оплата' ? 'Олег С.' : 'Ирина Б.'}
      </Text>
      <Text color="secondary">
        {node === 'Оформление'
          ? 'Запросы оформления передаются в оплату.'
          : node === 'Оплата'
            ? 'Оплата вызывает БД для подтверждения заказа.'
            : 'Соединения делят платежи и фоновая сверка.'}{' '}
        Связи из топологии демомагазина.
      </Text>
    </Card>
  )
}

export function AgentInvestigation({incident, cardHref}: {incident: Incident; cardHref: string}) {
  const {desk} = useWorkspace()
  const work = desk.work[incident.key]
  const reports = work?.reports.filter(isInvestigationReport) ?? []
  const run = new URLSearchParams(window.location.hash.split('?')[1]).get('run')
  const latest = reports[0]
  const saved = run === null ? latest : reports.find((r) => r.id === run)
  const analysis = saved?.analysis
  const outOfDate = saved && saved.revision !== (incident.updatedAt ?? 0)
  const settingsChanged = saved && work?.diagnosticsAt && work.diagnosticsAt > saved.at
  const missingRun = run !== null && !saved

  const savedId = saved?.id
  // Pin the first result as well, so reloads and evidence links always reopen this version.
  useEffect(() => {
    if (run !== null || savedId === undefined) return
    if (window.location.hash.split('?')[0] !== '#investigation/' + encodeURIComponent(incident.key)) return
    const href = investigationHref(incident.key, desk.mode, savedId)
    window.history.replaceState(window.history.state, '', href)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [incident.key, desk.mode, run, savedId])

  const evidence = analysis?.evidence ?? []
  const sourceNames = [...new Set(evidence.map((e) => e.source))]
  const onlyItsm = sourceNames.length === 1 && sourceNames[0] === 'ITSM'
  // Older reports copied the assigned ITSM group when there was no technical addressee.
  const assignedInReport = evidence.some(
    (e) => e.source === 'ITSM' && e.finding.endsWith(' · ' + analysis?.recipient),
  )
  const recipient =
    analysis?.hypothesis && analysis.recipient && analysis.recipient !== coordinatorGroup && !assignedInReport
      ? analysis.recipient
      : unknownTechnicalRecipient
  const unavailable = evidence.find((e) => e.finding === 'Свежие наблюдения недоступны')
  const recovered = analysis?.question.startsWith('Какую проверку выполнили после восстановления')
  const diagnosis = Boolean(analysis?.hypothesis)
  const current = saved?.id === latest?.id

  return (
    <section className="agent-run" aria-label="Разбор инцидента">
      <Link href={cardHref}>← Вернуться в карточку</Link>
      <header className="agent-run-heading">
        <div>
          <Text as="p" color="secondary">
            {incident.id} · {incident.product}
          </Text>
          <Text as="h1" variant="header-2">
            Разбор ИИ
          </Text>
          <Text as="p" variant="body-2">
            {incident.title}
          </Text>
        </div>
        {!missingRun && (
          <InvestigationAction incident={incident} repeat size="m" view={saved ? 'outlined' : 'action'} />
        )}
      </header>
      {work?.modelOffline && (
        <Text role="status" color="warning">
          Модель стенда недоступна.{' '}
          {saved ? 'Открыт сохранённый результат.' : 'Для запуска требуется подключение к модели.'}
        </Text>
      )}
      {outOfDate && (
        <Text role="status" color="warning">
          Карточка изменилась после этого разбора.
        </Text>
      )}
      {settingsChanged && (
        <Text role="status" color="warning">
          Условия стенда изменились после этого разбора.
        </Text>
      )}
      {missingRun ? (
        <div className="agent-run-empty">
          <Text as="h2" variant="header-1">
            Сохранённый запуск не найден
          </Text>
          {latest && (
            <Link href={investigationHref(incident.key, desk.mode, latest.id)}>
              Открыть последний разбор этого INC
            </Link>
          )}
        </div>
      ) : !saved ? (
        <Text role="status" color="secondary">
          По этому инциденту ещё нет разбора.
        </Text>
      ) : (
        <>
          {analysis ? (
            <>
              <div className="agent-run-decision" aria-label="Вывод и следующее действие">
                <div className="agent-run-status">
                  <Label theme={diagnosis ? 'warning' : 'info'}>
                    {diagnosis ? 'Гипотеза' : 'Недостаточно данных'}
                  </Label>
                </div>
                <Text as="h2" variant="header-2">
                  {analysis.hypothesis ||
                    (recovered ? analysis.question : 'Запросить время сбоя и ID одного запроса')}
                </Text>
                {!diagnosis && !recovered && (
                  <Text as="p">
                    По ним дежурный сможет найти запрос в логах и сверить его с трассировкой.
                  </Text>
                )}
                {diagnosis && (
                  <div className="agent-run-next">
                    <Text as="h3" variant="subheader-2">
                      Следующая проверка
                    </Text>
                    <Text as="p">{analysis.next}</Text>
                  </div>
                )}
                {unavailable && (
                  <Text as="p" color="warning">
                    {unavailable.finding}
                  </Text>
                )}
                <dl className="agent-run-facts">
                  <div>
                    <dt>Основание</dt>
                    <dd>
                      {onlyItsm
                        ? 'Только карточка ITSM'
                        : sourceNames.join(' · ') || 'У запуска нет наблюдений'}
                    </dd>
                  </div>
                  <div>
                    <dt>Кому передать</dt>
                    <dd>{recipient}</dd>
                  </div>
                </dl>
              </div>
              <details key={saved.id + '-sources'} className="agent-run-details">
                <summary>Основание и исходные записи</summary>
                <div className="agent-run-details-body">
                  <ol className="agent-evidence-rows">
                    {evidence.map((item, index) => (
                      <li key={index}>
                        <Text as="h3" variant="subheader-2">
                          {item.source}
                        </Text>
                        <Text as="p">{item.finding}</Text>
                        <code>{item.record}</code>
                        <Link
                          href={
                            '#evidence/' +
                            encodeURIComponent(incident.key) +
                            '?run=' +
                            encodeURIComponent(saved.id) +
                            '&source=' +
                            index +
                            '&dataset=' +
                            desk.mode
                          }
                        >
                          Открыть наблюдение
                        </Link>
                      </li>
                    ))}
                  </ol>
                  {diagnosis && (
                    <div>
                      <Text as="h3" variant="subheader-2">
                        Вопрос дежурному
                      </Text>
                      <Text as="p">{analysis.question}</Text>
                    </div>
                  )}
                </div>
              </details>
            </>
          ) : (
            <details open className="agent-run-details">
              <summary>Сохранённый текстовый отчёт</summary>
              <p className="report-text">{saved.content}</p>
            </details>
          )}
          <details key={saved.id + '-runs'} className="agent-run-details">
            <summary>Сведения о запуске</summary>
            <div className="agent-run-details-body">
              <dl className="agent-run-facts">
                <div>
                  <dt>Запуск №{saved.id}</dt>
                  <dd>{fullTime(standNow(desk, saved.at))} МСК · {usesRealBackend ? 'рабочее место' : 'стенд'}</dd>
                </div>
                <div>
                  <dt>Версия карточки</dt>
                  <dd>{saved.revision ? fullTime(standNow(desk, saved.revision)) + ' МСК' : 'Исходный снимок'}</dd>
                </div>
              </dl>
              {reports.length > 1 && (
                <div className="agent-run-history">
                  <Text as="h3" variant="subheader-2">
                    Другие запуски этого INC
                  </Text>
                  <ul>
                    {reports
                      .filter((r) => r.id !== saved.id)
                      .map((r) => (
                        <li key={r.id}>
                          <Link href={investigationHref(incident.key, desk.mode, r.id)}>
                            №{r.id} · {fullTime(standNow(desk, r.at))} МСК
                          </Link>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <Link href={'#incident/' + encodeURIComponent(incident.key) + '?tab=timeline'}>
                Хронология инцидента
              </Link>
            </div>
          </details>
          {analysis && current && incident.key === 'incident' && desk.mode === 'volume' && (
            <details className="agent-run-details">
              <summary>Проверить на стенде</summary>
              <div className="agent-run-details-body">
                <PaymentPath incident={incident} />
                <RecoveryExperiment incident={incident} />
              </div>
            </details>
          )}
        </>
      )}
    </section>
  )
}
