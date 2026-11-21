import {useMemo, useState} from 'react'
import {Button, Card, Checkbox, Flex, Label, Link, Select, Text, TextArea, TextInput} from '@gravity-ui/uikit'
import type {Incident} from '../demoData'
import {useWorkspace, useRelated} from './context'
import {dueInstant, emptyWork, fullTime, priorityNames} from './types'
import {cardTimeline} from './timeline'
import {RoutingAdvisor} from './RoutingAdvisor'
import {MessageComposer} from './NotificationCenter'

export function Collaboration({item, incidents}: {item: Incident; incidents: Incident[]}) {
  const {desk, act, person} = useWorkspace(),
    w = desk.work[item.key] ?? emptyWork()
  const [note, setNote] = useState(''),
    [kind, setKind] = useState('Заметка'),
    [owner, setOwner] = useState(desk.people.find((p) => p.id === person)?.name ?? ''),
    [due, setDue] = useState('')
  const candidates = useRelated(item)
  const byKey = useMemo(() => new Map(incidents.map((i) => [i.key, i])), [incidents])
  const last = candidates.find((x) => !!x.incident.restoredAt)
  const next = w.notes.find((n) => !n.done && n.kind === 'Следующий шаг')
  const summary = [
    item.id + ' · ' + item.title,
    'Влияние: ' + (item.impact || item.description || item.title),
    'Назначение ITSM: ' + item.team,
    'Срок: ' + (item.due || 'не указан'),
    'Исполнитель следующего шага: ' + (next?.owner ?? 'уточнить у смены'),
    'Следующее действие: ' + (next?.text ?? 'согласовать с дежурным') + (next?.due ? ' · к ' + next.due + ' МСК' : ''),
    'Открытые проверки: ' +
      (w.notes
        .filter((n) => !n.done && n.kind === 'Проверка')
        .map((n) => n.text + ' · ' + n.owner + (n.due ? ' · к ' + n.due + ' МСК' : ''))
        .join('; ') || 'нет записанных'),
    'Решение: ' + (item.solution || 'пока не указано'),
    'Встреча: ' + (w.room?.id ?? 'отсутствует'),
    'Проверено: ' +
      (w.notes
        .filter((n) => n.done)
        .map((n) => n.text)
        .join('; ') || 'нет завершённых проверок'),
    'Последнее исследование: ' +
      (w.reports.find((r) => r.analysis)?.analysis?.hypothesis ?? 'подтверждённого объяснения пока нет'),
  ].join('\n')
  return (
    <div className="desk-stack">
      <nav aria-label="Разделы работы смены" className="desk-jumps">
        {[
          ['work-links', 'Связи'],
          ['work-advisor', 'Маршрутизация'],
          ['work-notes', 'Записи'],
          ['work-brief', 'Передача смены'],
          ['work-notify', 'Оповещение'],
        ].map(([id, title]) => (
          <Button
            key={id}
            size="s"
            view="outlined"
            onClick={() => {
              const section = document.getElementById(id)
              section?.focus({preventScroll: true})
              section?.scrollIntoView({block: 'start'})
            }}
          >
            {title}
          </Button>
        ))}
      </nav>
      <Card id="work-links" tabIndex={-1} className="mcc-glass incident-panel">
        <Flex alignItems="center" gap="spacing-2">
          <Text as="h2" variant="header-1">
            Связанные инциденты
          </Text>
          <Label>{w.links.length}</Label>
        </Flex>
        {w.links.map((k) => (
          <Flex key={k} gap="spacing-2" wrap>
            <Link href={'#incident/' + k}>
              {byKey.get(k)?.id} · {byKey.get(k)?.title}
            </Link>
            <Button size="s" onClick={() => void act({type: 'unlink', key: item.key, value: k})}>
              Снять связь
            </Button>
          </Flex>
        ))}
        <Text color="secondary">
          Кандидаты из индекса по сервису, продукту и тексту симптома. Связь подтверждает координатор.
        </Text>
        {!candidates.length && <Text>Совпадений по нескольким признакам нет.</Text>}
        <ul className="desk-list">
          {candidates
            .filter((c) => !w.links.includes(c.incident.key))
            .map((c) => (
              <li key={c.incident.key}>
                <Link href={'#incident/' + c.incident.key}>
                  {c.incident.id} · {c.incident.title}
                </Link>
                <Text color="secondary">{c.reasons.slice(0, 4).join(' · ')}</Text>
                <Button
                  size="s"
                  onClick={() => void act({type: 'link', key: item.key, value: c.incident.key})}
                >
                  Подтвердить связь
                </Button>
              </li>
            ))}
        </ul>
      </Card>
      <div id="work-advisor" tabIndex={-1}>
        <RoutingAdvisor item={item} past={last?.incident} />
      </div>
      <Card id="work-notes" tabIndex={-1} className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">
          Заметки и действия
        </Text>
        <Flex gap="spacing-2" wrap>
          <Select
            label="Тип"
            value={[kind]}
            options={['Заметка', 'Следующий шаг', 'Проверка'].map((value) => ({value, content: value}))}
            onUpdate={([v]) => setKind(v)}
          />
          <TextInput label="Ответственный" value={owner} onUpdate={setOwner} />
          <TextInput label="Срок проверки" placeholder="ЧЧ:ММ" value={due} onUpdate={setDue} />
        </Flex>
        <TextArea rows={2} controlProps={{'aria-label': 'Текст записи'}} value={note} onUpdate={setNote} />
        <Button
          disabled={!note.trim() || !owner.trim()}
          onClick={async () => {
            if (await act({type: 'note', person, key: item.key, text: note, kind, owner, due})) setNote('')
          }}
        >
          Добавить запись
        </Button>
        <ul className="desk-list">
          {w.notes.map((n) => (
            <li key={n.id}>
              {n.kind === 'Заметка' ? (
                <Text>{n.text}</Text>
              ) : (
                <Checkbox
                  checked={n.done}
                  onUpdate={() => void act({type: 'toggleNote', key: item.key, id: n.id})}
                >
                  {n.text}
                </Checkbox>
              )}
              <Text color="secondary">
                {n.kind} · {n.owner} · {fullTime(n.at)} {n.due ? '· к ' + n.due : ''}
              </Text>
            </li>
          ))}
        </ul>
      </Card>
      <Card id="work-brief" tabIndex={-1} className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">
          Передача смены и постмортем
        </Text>
        <p className="report-text">{summary}</p>
        <Flex gap="spacing-2" wrap>
          <Button
            onClick={() => void act({type: 'report', key: item.key, title: 'Передача смены', text: summary})}
          >
            Сохранить сводку смены
          </Button>
          <Button
            onClick={() =>
              void act({
                type: 'report',
                key: item.key,
                title: 'Черновик постмортема',
                text:
                  summary +
                  '\nХронология:\n' +
                  cardTimeline(desk, item)
                    .map((e) => fullTime(e.at) + ' · ' + e.source + ' · ' + e.text)
                    .join('\n') +
                  '\nСвидетельства: ' +
                  (w.reports.find((r) => r.title === 'Разбор агента')?.content ?? 'запустить исследование') +
                  '\nОткрытый вопрос: какая причина подтверждена командой?',
              })
            }
          >
            Подготовить черновик разбора
          </Button>
        </Flex>
        {w.reports.map((r) => (
          <details key={r.id}>
            <summary>
              {r.title} · {fullTime(r.at)}
            </summary>
            <p className="report-text">{r.content}</p>
            {r.analysis && <Link href={'#investigation/' + item.key + '?run=' + r.id + '&tab=work&dataset=' + desk.mode}>Открыть сохранённый разбор</Link>}
            <Text color="secondary">Версия данных {r.revision}</Text>
          </details>
        ))}
      </Card>
      <div id="work-notify" tabIndex={-1}>
        <MessageComposer incident={item} />
      </div>
    </div>
  )
}
export function Meeting({item}: {item: Incident}) {
  const {desk, act, person} = useWorkspace(),
    room = desk.work[item.key]?.room
  const [invite, setInvite] = useState(''),
    [team, setTeam] = useState('')
  if (!room)
    return (
      <Card className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">
          Аварийная комната
        </Text>
        <Text>К этой карточке встреча ещё не привязана.</Text>
        <Button onClick={() => void act({type: 'room', key: item.key, person})}>Открыть демовстречу</Button>
      </Card>
    )
  return (
    <Card className="mcc-glass incident-panel">
      <Flex alignItems="center" gap="spacing-2" wrap>
        <Text as="h2" variant="header-1">
          Аварийная комната
        </Text>
        <Label theme={room.ended ? 'normal' : 'success'}>{room.ended ? 'Завершена' : 'Идёт встреча'}</Label>
      </Flex>
      {!location.hash.startsWith('#meeting/') && (
        <Link href={'#meeting/' + item.key}>Открыть Emergency Room · {room.id}</Link>
      )}
      <Text color="secondary">Стенд МТС Линк · {item.id}</Text>
      <ul className="desk-list">
        {room.members.map((m) => (
          <li key={m.role}>
            <Text variant="subheader-2">
              {m.role} · {m.team}
            </Text>
            <Text>
              Уведомление: {m.delivery} · приглашение {m.invited}
            </Text>
            <Text>
              {m.left ? 'Вышел в ' + m.left : m.joined ? (room.ended ? 'Подключился в ' : 'В звонке с ') + m.joined : 'Вход не зафиксирован'}
            </Text>
            {!room.ended && (
              <Flex gap="spacing-2" wrap>
                <Button
                  size="s"
                  onClick={() =>
                    void act({
                      type: 'roomMember',
                      key: item.key,
                      owner: m.role,
                      kind: m.joined && !m.left ? 'leave' : 'join',
                    })
                  }
                >
                  {m.joined && !m.left ? 'Зафиксировать выход' : 'Зафиксировать вход'}
                </Button>
                {m.delivery !== 'Прочитано' && (
                  <Button
                    size="s"
                    view="flat"
                    onClick={() => void act({type: 'roomMember', key: item.key, owner: m.role, kind: 'read'})}
                  >
                    Отметить прочтение
                  </Button>
                )}
                {m.delivery === 'Доставлено' && !m.joined && (
                  <Button
                    size="s"
                    view="flat"
                    onClick={() => void act({type: 'roomMember', key: item.key, owner: m.role, kind: 'miss'})}
                  >
                    Зафиксировать пропуск
                  </Button>
                )}
              </Flex>
            )}
          </li>
        ))}
      </ul>
      {!!room.timeline?.length && (
        <details>
          <summary>История участия и уведомлений</summary>
          {room.timeline.map((e, i) => (
            <p key={i}>
              {fullTime(e.at)} · {e.who} · {e.text}
            </p>
          ))}
        </details>
      )}
      {!room.ended ? (
        <>
          <Flex gap="spacing-2" wrap>
            <TextInput label="Участник" value={invite} onUpdate={setInvite} />
            <TextInput label="Команда участника" value={team} onUpdate={setTeam} />
            <Button
              disabled={!invite.trim() || !team.trim()}
              onClick={async () => {
                if (
                  await act({type: 'roomMember', key: item.key, owner: invite, kind: 'invite', value: team})
                ) {
                  setInvite('')
                  setTeam('')
                }
              }}
            >
              Пригласить на стенде
            </Button>
          </Flex>
          <Text color="secondary">Транскрипт готовится после завершения встречи.</Text>
          <Button onClick={() => void act({type: 'meetingEnd', key: item.key})}>Завершить демовстречу</Button>
        </>
      ) : (
        <>
          <Text as="h3" variant="subheader-3">
            Сводка по транскрипту
          </Text>
          <p className="report-text">
            {desk.work[item.key]?.reports.find((r) => r.title === 'Сводка встречи ' + room.id)?.content}
          </p>
          <Flex gap="spacing-2" wrap>
            {room.fragments.map((f, i) => (
              <Button
                key={i}
                size="s"
                view="outlined"
                onClick={() => {
                  const fragment = document.getElementById('fragment-' + i)
                  fragment?.focus()
                  fragment?.scrollIntoView({block: 'center'})
                }}
              >
                К фрагменту {f.at} · {f.who}
              </Button>
            ))}
          </Flex>
          <Text as="h3" variant="subheader-2">
            Фрагменты деморасшифровки
          </Text>
          {room.fragments.map((f, i) => (
            <p tabIndex={-1} id={'fragment-' + i} key={i}>
              <strong>
                {f.at} · {f.who}
              </strong>{' '}
              {f.text}
            </p>
          ))}
        </>
      )}
    </Card>
  )
}
export function OfficialCard({item}: {item: Incident}) {
  const {act} = useWorkspace()
  const [team, setTeam] = useState(item.team),
    [priority, setPriority] = useState(String(item.priority)),
    [status, setStatus] = useState(item.state)
  const [solution, setSolution] = useState(item.solution ?? ''),
    [employee, setEmployee] = useState(item.assignee ?? '')
  const due = dueInstant(item)
  const sourceDeadline = due === null ? '' : new Date(due + 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
  const [deadline, setDeadline] = useState(sourceDeadline),
    [dateChanged, setDateChanged] = useState(false),
    [expected, setExpected] = useState(item.updatedAt ?? 0)
  return (
    <Card className="mcc-glass incident-panel">
      <Link href={'#incident/' + item.key}>← В дашборд</Link>
      <Text as="h1" variant="header-2">
        ITSM · карточка {item.id}
      </Text>
      <Label theme="info">Мок официального источника</Label>
      <Text>
        {item.product} · {item.title}
      </Text>
      <div className="desk-grid">
        <TextInput label="Группа назначения" value={team} onUpdate={setTeam} />
        <TextInput label="Исполнитель" value={employee} onUpdate={setEmployee} />
        <Select
          label="Приоритет"
          value={[priority]}
          options={priorityNames.map((content, i) => ({value: String(i + 1), content}))}
          onUpdate={([v]) => setPriority(v)}
        />
        <Select
          label="Статус"
          value={[status]}
          options={['Назначен', 'В работе', 'Выполняется', 'Завершён', 'Исследование ситуации', 'Закрыт'].map(
            (v) => ({value: v, content: v}),
          )}
          onUpdate={([v]) => setStatus(v)}
        />
        <TextInput
          label="Срок решения (МСК)"
          placeholder="ГГГГ-ММ-ДД ЧЧ:ММ"
          value={deadline}
          onUpdate={(v) => {
            setDeadline(v)
            setDateChanged(true)
          }}
        />
      </div>
      <TextArea
        value={solution}
        onUpdate={setSolution}
        placeholder="Описание решения"
        controlProps={{'aria-label': 'Описание решения'}}
      />
      <Flex gap="spacing-2" wrap>
        <Button
          view="action"
          onClick={async () => {
            const ok = await act({
              type: 'edit',
              key: item.key,
              expected,
              data: {
                team,
                priority: Number(priority),
                state: status,
                solution,
                assignee: employee,
                ...(dateChanged ? {due: deadline.trim() ? deadline.trim().replace(' ', 'T') + ':00+03:00' : null} : {}),
              },
            })
            if (ok) location.hash = 'incident/' + item.key + '?tab=history'
          }}
        >
          Сохранить в мок-ITSM
        </Button>
        <Button
          onClick={() => {
            setExpected(item.updatedAt ?? 0)
            setTeam(item.team)
            setEmployee(item.assignee ?? '')
            setStatus(item.state)
            setPriority(String(item.priority))
            setSolution(item.solution ?? '')
            setDateChanged(false)
            setDeadline(sourceDeadline)
          }}
        >
          Перечитать карточку
        </Button>
      </Flex>

    </Card>
  )
}
