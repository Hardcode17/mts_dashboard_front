import {useState} from 'react'
import {
  Button,
  Card,
  Checkbox,
  Select,
  TextInput,
  Disclosure,
  Flex,
  Label,
  Link,
  Text,
} from '@gravity-ui/uikit'
import {incidentRevisions, type Incident} from './demoData'
import {useWorkspace} from './desk/context'
import {fullTime} from './desk/types'
import {measures, recoveryTrial} from './desk/recovery'
import {cardChanges, historyFields} from './incidentHistory'

function RecoveryExperiment({incident}: {incident: Incident}) {
  const {desk, refresh} = useWorkspace(),
    w = desk.work[incident.key]
  const [input, setInput] = useState('100')
  const [progress, setProgress] = useState<number | null>(null),
    [failure, setFailure] = useState('')
  async function probe() {
    const count = Number(input)
    async function request(data: Record<string, unknown>) {
      const r = await fetch('/api/stand/shop?mode=volume', {
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
      <TextInput label="Уникальных заказов в минуту" type="number" value={input} onUpdate={setInput} />
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
  const {desk, act} = useWorkspace(),
    w = desk.work[incident.key]
  const [interval, setIntervalValue] = useState(String(w?.dataInterval ?? 5)),
    [age, setAge] = useState(String(w?.lastRowAge ?? 2))
  const [object, setObject] = useState(w?.dataObject ?? 'payment_registry')
  const [missing, setMissing] = useState(!!w?.telemetryOffline),
    [offline, setOffline] = useState(!!w?.modelOffline),
    [profile, setProfile] = useState(w?.profile ?? 'database')
  return (
    <details className="mcc-glass incident-panel">
      <summary>Источники и проверки стенда</summary>
      <Text>
        Проверка таблицы / индекса: сравнивается возраст последней записи с ожидаемым интервалом обновления.
      </Text>
      <TextInput label="Таблица или индекс продукта" value={object} onUpdate={setObject} />
      <Flex gap="spacing-2" wrap>
        <TextInput
          label="Ожидаемый интервал, мин"
          type="number"
          value={interval}
          onUpdate={setIntervalValue}
        />
        <TextInput label="Возраст записи, мин" type="number" value={age} onUpdate={setAge} />
      </Flex>
      {incident.key === 'incident' && (
        <Select
          label="Сценарий замедления"
          value={[profile]}
          options={[
            {value: 'database', content: 'Ожидание БД'},
            {value: 'workers', content: 'Насыщение обработчиков'},
          ]}
          onUpdate={([v]) => setProfile(v === 'workers' ? 'workers' : 'database')}
        />
      )}
      <Checkbox checked={missing} onUpdate={setMissing}>
        Источник телеметрии недоступен
      </Checkbox>
      <Checkbox checked={offline} onUpdate={setOffline}>
        Модель недоступна
      </Checkbox>
      <Button
        onClick={() =>
          void act({
            type: 'diagnostics',
            key: incident.key,
            number: Number(interval),
            age: Number(age),
            value: profile,
            title: object,
            enabled: missing,
            kind: offline ? 'offline' : 'online',
          })
        }
      >
        Сохранить условия проверки
      </Button>
    </details>
  )
}

export function AgentInvestigation({incident, cardHref}: {incident: Incident; cardHref: string}) {
  const {desk, act, busy} = useWorkspace()
  const [node, setNode] = useState('Оплата')
  const run = new URLSearchParams(window.location.hash.split('?')[1]).get('run')
  const reports = desk.work[incident.key]?.reports
  const saved = reports?.find(r => r.analysis && (!run || r.id === run))
  const report = saved?.analysis
  const currentHref = '#investigation/' + incident.key + '?dataset=' + desk.mode
  const latest = cardChanges(desk.revisions[incident.key] ?? incidentRevisions.get(incident.key) ?? [])[0]
  return (
    <Flex direction="column" gap="spacing-5" className="incident-view">
      <Link href={cardHref}>← Вернуться в карточку</Link>
      <Flex direction="column" gap="spacing-2">
        <Flex alignItems="center" gap="spacing-2" wrap>
          <Text variant="code-inline-1">{incident.id}</Text>
          <Label theme="info">Демо агента</Label>
        </Flex>
        <Text as="h1" variant="display-2">
          Разбор причины агентом
        </Text>
        <Text variant="body-2">
          {incident.product} · {incident.title}
        </Text>
        <Text color="secondary">
          Разбор использует локальные данные стенда. Время наблюдений — московское.
        </Text>
      </Flex>
      <Flex alignItems="center" gap="spacing-3" wrap>
        {run ? <Button href={currentHref}>К текущему разбору</Button>
          : <Button view="action" disabled={busy} onClick={() => void act({type: 'analyze', key: incident.key})}>
          {saved ? 'Повторить анализ' : 'Запустить анализ'}
        </Button>}
        {saved && (
          <Text color="secondary">
            Запуск №{saved.id} · {fullTime(saved.at)} · {saved.revision ? 'карточка от '+fullTime(saved.revision) : 'исходная карточка'}
            {saved.revision !== (incident.updatedAt ?? 0) ? ' · карточка изменилась' : ''}
          </Text>
        )}
      </Flex>
      {!run && <Diagnostics incident={incident} />}
      {!report ? <Text role="status">{run ? 'Сохранённый запуск не найден в этом инциденте.' : 'Запустите анализ, чтобы увидеть наблюдения и следующую проверку.'}</Text> :
      <div className="incident-evidence">
        <Card className="mcc-glass incident-panel">
          <Text as="h2" variant="header-1">
            Что проверил агент
          </Text>
          <ol className="agent-checks">
            {report.evidence.map((item, index) => (
              <li key={item.source}>
                <Text as="h3" variant="subheader-2">
                  {item.source}
                </Text>
                <Text as="p">{item.finding}</Text>
                <Disclosure summary="Исходная запись">
                  <Text as="p" variant="code-inline-1" className="agent-record">
                    {item.record}
                  </Text>
                  {saved && (
                    <Link href={'#evidence/' + incident.key + '?run=' + saved.id + '&source=' + index + '&dataset=' + desk.mode}>
                      Открыть наблюдение
                    </Link>
                  )}
                </Disclosure>
              </li>
            ))}
            {!run && latest && (
              <li>
                <Text as="h3" variant="subheader-2">
                  История этой карточки
                </Text>
                <Text as="p">
                  {latest.changedAt ? 'Изменение в ' + latest.changedAt : 'Замечено в ' + latest.observedAt}.
                  Поля: {latest.changes.map((change) => historyFields[change.field]).join(', ')}.
                </Text>
                <Link href={'#incident/' + incident.key + '?tab=history'}>Сверить с историей изменений</Link>
              </li>
            )}
          </ol>
        </Card>
        <Card className="mcc-glass incident-panel incident-hypothesis">
          <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap>
            <Text as="h2" variant="header-1">
              Вывод агента
            </Text>
            <Label theme={report.hypothesis ? 'warning' : 'info'}>
              {report.hypothesis ? 'Гипотеза' : 'Недостаточно данных'}
            </Label>
          </Flex>
          <Text variant="body-2">
            {report.hypothesis ??
              'Для определения причины недостаточно подтверждённых наблюдений по этому инциденту.'}
          </Text>
          <div>
            <Text as="h3" variant="subheader-2">
              Кого спросить
            </Text>
            <Text>{report.recipient}</Text>
          </div>
          <div>
            <Text as="h3" variant="subheader-2">
              Вопрос дежурному
            </Text>
            <Text>{report.question}</Text>
          </div>
          <div>
            <Text as="h3" variant="subheader-2">
              Следующая проверка
            </Text>
            <Text>{report.next}</Text>
          </div>
          {!report.scenario && desk.mode === 'volume' && incident.key !== 'incident' && (
            <Link href="#investigation/incident">Посмотреть полный пример со сбоем оплаты →</Link>
          )}
        </Card>
      </div>}
      {!run && report && incident.key === 'incident' && desk.mode === 'volume' && (
        <>
          <Card className="mcc-glass incident-panel">
            <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap>
              <Text as="h2" variant="header-1">
                Путь заказа
              </Text>
              <Text color="secondary" variant="caption-2">
                {desk.work[incident.key]?.telemetryOffline
                  ? 'Телеметрия недоступна'
                  : 'Демозамер на 12:42 МСК'}
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
              {node === 'База данных'
                ? 'Платформа БД'
                : node === 'Оплата'
                  ? 'Команда платежей'
                  : 'Команда заказов'}{' '}
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
          <RecoveryExperiment incident={incident} />
        </>
      )}
    </Flex>
  )
}
