import {Text} from '@gravity-ui/uikit'
import type {Incident} from '../demoData'
import {useWorkspace} from './context'
import {incidentDeadline} from './deadline'
import {active, moscowTime, standNow} from './types'

const date = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function IncidentDeadline({incident}: {incident: Incident}) {
  const {desk, now} = useWorkspace()
  const {label, due, overdue} = incidentDeadline(incident, standNow(desk, now))
  return (
    <div className={'incident-deadline' + (overdue ? ' incident-deadline-overdue' : '')}>
      <Text as="span" variant="body-1" color="secondary">
        Срок решения
      </Text>
      <Text as="strong" variant="display-1" className="incident-deadline-value">
        {label}
      </Text>
      {due !== null ? (
        <time dateTime={new Date(due).toISOString()}>
          {date.format(due)} · {moscowTime(due)} МСК
        </time>
      ) : (
        !active(incident) && <Text color="secondary">Срок не указан</Text>
      )}
    </div>
  )
}
