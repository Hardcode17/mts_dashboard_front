import {useMemo, useState} from 'react'
import {
  Button,
  Card,
  Checkbox,
  Flex,
  Label,
  Link,
  Pagination,
  Select,
  Text,
  TextArea,
  TextInput,
} from '@gravity-ui/uikit'
import {useWorkspace} from './context'
import {channels, fullTime, standNow, type Attempt, type Channel, type Notice} from './types'
import type {Incident} from '../demoData'

export function ChannelPicker({
  value,
  change,
  disabled = false,
}: {
  value: Channel[]
  change: (c: Channel[]) => void
  disabled?: boolean
}) {
  return (
    <div className="channel-picker">
      {channels.map((c) => (
        <Checkbox
          key={c}
          disabled={disabled}
          checked={value.includes(c)}
          onUpdate={(on) => change(on ? [...value, c] : value.filter((v) => v !== c))}
        >
          {c}
        </Checkbox>
      ))}
    </div>
  )
}
export function MessageComposer({incident}: {incident: Incident}) {
  const {desk, act, busy} = useWorkspace()
  const [selected, setSelected] = useState<Channel[]>(desk.enabled),
    [recipient, setRecipient] = useState(incident.team || 'Дежурный смены')
  const [text, setText] = useState(
    'Прошу сообщить статус по ' + incident.id + ' и следующий шаг по восстановлению.',
  )
  const [sent, setSent] = useState(false)
  return (
    <Card className="mcc-glass incident-panel">
      <Text as="h3" variant="subheader-3">
        Запрос статуса и эскалация
      </Text>
      <TextInput label="Получатель" value={recipient} onUpdate={value => {setRecipient(value); setSent(false)}} />
      <TextArea value={text} onUpdate={value => {setText(value); setSent(false)}} controlProps={{'aria-label': 'Текст сообщения'}} rows={3} />
      <ChannelPicker
        value={selected}
        change={(v) => {
          setSelected(v)
          setSent(false)
        }}
      />
      <Flex gap="spacing-2" wrap>
        <Button
          disabled={!text.trim() || !recipient.trim() || !selected.length || busy}
          view="action"
          onClick={async () =>
            setSent(await act({type: 'send', key: incident.key, person: recipient, text, channels: selected}))
          }
        >
          Отправить на стенде
        </Button>
        <Button
          onClick={() => {
            setText(
              'Эскалация ' +
                incident.id +
                '. ' +
                incident.title +
                '. Срок: ' +
                (incident.due || 'не указан') +
                '. Требуется решение ответственного.',
            )
            setSent(false)
          }}
        >
          Подготовить эскалацию
        </Button>
      </Flex>
      {sent && <Link href={'#desk/notifications?incident=' + encodeURIComponent(incident.key)}>Проверить доставку →</Link>}
    </Card>
  )
}
function AssignmentNotice({notice, attempt}: {notice: Notice; attempt?: Attempt}) {
  const {act, busy, now, person} = useWorkspace()
  if (!notice.attempt || notice.recipient !== person) return null
  if (attempt?.accepted && attempt.ended) return <Text color="secondary">{attempt.reason || 'Задача завершена'}</Text>
  if (!attempt || attempt.ended || (!attempt.accepted && attempt.deadline !== null && attempt.deadline <= now)) {
    return <Text color="secondary">Назначение устарело</Text>
  }
  if (attempt.accepted) return <Link href="#desk/tasks">Принято · к моей задаче</Link>
  if (notice.status === 'Ошибка') return null
  return (
    <Button disabled={busy} onClick={async () => {
      if (await act({type: 'accept', key: notice.key, id: attempt.id, person})) location.hash = 'desk/tasks'
    }}>
      Принять назначение
    </Button>
  )
}

export function NotificationCenter({incidents}: {incidents: Incident[]}) {
  const {desk, act, person, busy} = useWorkspace()
  const incidentKey = new URLSearchParams(location.hash.split('?')[1]).get('incident')
  const numbers = useMemo(() => new Map(incidents.map(i => [i.key, i.id])), [incidents])
  const attempts = useMemo(() => new Map(desk.tasks.flatMap(t => t.attempts.map(a => [a.id, a] as const))), [desk.tasks])
  const [channel, setChannel] = useState('all'),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [mine, setMine] = useState(false)
  const rows = useMemo(() => desk.notices.filter(n =>
    (!incidentKey || n.key === incidentKey) && (!mine || (n.attempt && n.recipient === person)) &&
    (channel === 'all' || n.channel === channel) && (status === 'all' || n.status === status)
  ), [desk.notices, incidentKey, mine, person, channel, status])
  const size = 15,
    current = Math.max(1, Math.min(page, Math.ceil(rows.length / size)))
  return (
    <div className="shift-layout shift-notifications">
      <Card className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">
          Доставка уведомлений
        </Text>
        {incidentKey && <Flex alignItems="center" wrap gap="spacing-3">
          <Link href={'#incident/' + incidentKey + '?tab=work'}>{numbers.get(incidentKey) ?? incidentKey} · Работа смены</Link>
          <Link href="#desk/notifications">Все инциденты</Link>
        </Flex>}
        <Flex gap="spacing-2" wrap>
          <Select
            label="Канал"
            value={[channel]}
            options={['all', ...channels].map((v) => ({value: v, content: v === 'all' ? 'Все' : v}))}
            onUpdate={([v]) => {
              setChannel(v)
              setPage(1)
            }}
          />
          <Select
            label="Результат"
            value={[status]}
            options={['all', 'Доставлено', 'Ошибка', 'Прочитано'].map((v) => ({
              value: v,
              content: v === 'all' ? 'Все' : v,
            }))}
            onUpdate={([v]) => {
              setStatus(v)
              setPage(1)
            }}
          />
        </Flex>
        <Flex alignItems="center" wrap gap="spacing-3">
          <Checkbox checked={mine} onUpdate={value => {setMine(value); setPage(1)}}>Мои назначения</Checkbox>
          <Text color="secondary">Доставок: {rows.length}</Text>
        </Flex>
        {!rows.length && <Text>Подходящих доставок пока нет.</Text>}
        <ul className="desk-list">
          {rows.slice((current - 1) * size, current * size).map((n) => (
            <li key={n.id}>
              <Flex alignItems="center" gap="spacing-2" wrap>
                <Text variant="subheader-2">{n.channel}</Text>
                <Label
                  theme={n.status === 'Ошибка' ? 'danger' : n.status === 'Прочитано' ? 'success' : 'info'}
                >
                  {n.status}
                </Label>
                <Text color="secondary">{fullTime(standNow(desk, n.at))}</Text>
              </Flex>
              <Text>{n.text}</Text>
              <Text color="secondary">
                Кому:{' '}
                {desk.people.find((p) => p.id === n.recipient)?.name ??
                  (n.recipient === 'shift' ? 'Дежурная смена' : n.recipient)}{' '}
                · Попыток: {n.tries}
              </Text>
              <Flex gap="spacing-2" alignItems="center" wrap>
                <Link href={'#incident/' + n.key}>{numbers.get(n.key) ?? n.key}</Link>
                {n.status === 'Ошибка' && (
                  <Button onClick={() => void act({type: 'retry', id: n.id})}>Повторить доставку</Button>
                )}
                {n.status === 'Доставлено' && (
                  <Button view="flat" onClick={() => void act({type: 'read', id: n.id})}>
                    Отметить прочитанным
                  </Button>
                )}
                {n.attempt && <AssignmentNotice notice={n} attempt={attempts.get(n.attempt)} />}
              </Flex>
            </li>
          ))}
        </ul>
        {rows.length > size && (
          <Pagination
            className="shift-pagination"
            compact
            showInput
            page={current}
            pageSize={size}
            total={rows.length}
            onUpdate={setPage}
          />
        )}
      </Card>
      <Card className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">
          Каналы смены
        </Text>
        <ChannelPicker
          disabled={busy}
          value={desk.enabled}
          change={(c) => void act({type: 'channels', channels: c})}
        />
        <details>
          <summary>Имитировать ошибку доставки</summary>
          <p>Выбранные адаптеры вернут ошибку. Снимите пометку и повторите нужную доставку.</p>
          <ChannelPicker
            disabled={busy}
            value={desk.failedChannels}
            change={(c) => void act({type: 'failChannels', channels: c})}
          />
        </details>
      </Card>
    </div>
  )
}
