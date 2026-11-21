import {useState} from 'react'
import {Button, Link, Pagination, Text} from '@gravity-ui/uikit'
import type {Incident} from './demoData'
import {moscowTime, standNow, type Desk, type QueueKey, type QueueMovement} from './desk/types'

import {queues, latestTransitions, type Activity} from './desk/queueActivity'

export function QueueCounts({activity}: {activity: Activity}) {
  return (
    <span className="queue-counts">
      <span>За минуту</span>
      <strong data-direction="in" data-changed={activity.entered > 0}>
        Добавилось {activity.entered}
      </strong>
      <strong data-direction="out" data-changed={activity.exited > 0}>
        Выбыло {activity.exited}
      </strong>
    </span>
  )
}

type MovementProps = {byKey: Map<string, Incident>; desk: Desk}

function Movement({move, byKey, desk}: MovementProps & {move: QueueMovement}) {
  const item = byKey.get(move.key)
  return (
    <li>
      <time dateTime={new Date(move.at).toISOString()}>{moscowTime(standNow(desk, move.at))}</time>
      <span>
        {move.entered ? 'Вход' : 'Выход'} · {move.reason}
      </span>
      <Link href={'#incident/' + move.key}>
        {item?.id ?? move.key}
        {item && ' · ' + item.product + ' · ' + item.title}
      </Link>
    </li>
  )
}

export function LatestActivity({
  queue,
  activity,
  ...props
}: MovementProps & {queue: QueueKey; activity: Activity}) {
  if (!activity.movements.length) return null
  return (
    <div className="queue-latest">
      <ul>
        {latestTransitions(activity).map((move) => (
          <Movement key={move.id} move={move} {...props} />
        ))}
      </ul>
      <Link href={'#events?queue=' + queue}>Все изменения за минуту →</Link>
    </div>
  )
}

export function MovementJournal({
  queue,
  activity,
  ...props
}: MovementProps & {queue: QueueKey; activity: Activity}) {
  const [snapshot, setSnapshot] = useState(() => ({rows: activity.movements, until: Date.now()}))
  const {rows, until} = snapshot
  const [page, setPage] = useState(1)
  return (
    <section className="overview-table-panel mcc-glass movement-journal" aria-label="Изменения очереди">
      <Text as="h2" variant="header-2">
        {queues.find((q) => q.key === queue)?.title} · изменения за минуту
      </Text>
      <Text color="secondary">
        Снимок на {moscowTime(standNow(props.desk, until))} МСК · переходов: {rows.length}
      </Text>
      <div>
        <Link href={'#overview?section=' + queue}>Вернуться к очереди</Link> ·{' '}
        <Link href="#events">Журнал всей смены</Link>
      </div>
      {rows[0]?.id !== activity.movements[0]?.id || rows.length !== activity.movements.length ? (
        <Button
          onClick={() => {
            setSnapshot({rows: activity.movements, until: Date.now()})
            setPage(1)
          }}
        >
          Показать обновления
        </Button>
      ) : null}
      {rows.length ? (
        <ul>
          {rows.slice((page - 1) * 25, page * 25).map((move) => (
            <Movement key={move.id} move={move} {...props} />
          ))}
        </ul>
      ) : (
        <Text>За последнюю минуту изменений нет.</Text>
      )}
      {rows.length > 25 && (
        <Pagination
          compact
          className="overview-pagination"
          page={page}
          pageSize={25}
          total={rows.length}
          onUpdate={setPage}
        />
      )}
    </section>
  )
}
