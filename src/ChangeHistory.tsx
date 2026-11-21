import {useState} from 'react'
import {apiHistoryFact, historyValue, parseHistoryTime} from './desk/timeline'
import {useWorkspace} from './desk/context'
import {fullTime, type Incident} from './desk/types'
import {Card, Flex, Select, Text} from '@gravity-ui/uikit'
import type {IncidentHistoryLoad} from './features/incidents/model/useIncidentHistory'
import {cardChanges, historyFields, type TrackedField} from './incidentHistory'

const stamp = (value: string) => {
  const at = parseHistoryTime(value)
  return at === undefined ? 'Время не указано' : fullTime(at)
}

function ChangeFields({changes}: {changes: ReturnType<typeof apiHistoryFact>['changes']}) {
  if (!changes.length) return null
  return (
    <div className="history-fields">
      {changes.map((change) => (
        <div key={change.field}>
          <Text as="h3" variant="subheader-2">{historyFields[change.field]}</Text>
          <dl className="history-values">
            <div>
              <dt>Было</dt>
              <dd>{historyValue(change.field, change.before)}</dd>
            </div>
            <div>
              <dt>Стало</dt>
              <dd>{historyValue(change.field, change.after)}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  )
}

export function ChangeHistory({incident, history}: {incident: Incident; history?: IncidentHistoryLoad}) {
  const {desk, mode} = useWorkspace()
  const versions = mode === 'api' ? [] : desk.revisions[incident.key] ?? []
  const revisions = cardChanges(versions)
  const facts = (history?.events ?? [])
    .filter(event => event.incidentId === incident.id)
    .map(apiHistoryFact)
    .sort((first, second) => (second.at ?? -Infinity) - (first.at ?? -Infinity) || second.id - first.id)
  const registeredAt = incident.registeredAt
  const [left, setLeft] = useState(0),
    [right, setRight] = useState(-1)
  const a = Math.min(left, versions.length - 1),
    b = right < 0 ? versions.length - 1 : Math.min(right, versions.length - 1)
  const snapshot = (n: number) => Object.assign({}, ...versions.slice(0, n + 1).map((v) => v.values))
  const from = snapshot(a),
    to = snapshot(b),
    options = versions.map((v, i) => ({
      value: String(i),
      content: '#' + (i + 1) + ' · ' + stamp(v.observedAt),
    }))
  const changed = (Object.keys(historyFields) as TrackedField[]).filter((k) => from[k] !== to[k])
  return (
    <Card className="mcc-glass incident-panel">
      <Text as="h2" variant="header-1">
        История изменений
      </Text>
      <Text color="secondary" variant="body-1">
        {incident.id} · ITSM · время московское
      </Text>
      {versions.length > 1 && (
        <details>
          <summary>Сравнить версии карточки</summary>
          <div className="mcc-disclosure-body">
            <div className="incident-fields">
              <div className="mcc-field">
                <label htmlFor="revision-before">Было</label>
                <Select id="revision-before" width="max"
                  value={[String(a)]}
                  options={options}
                  onUpdate={([v]) => setLeft(Number(v))}
                />
              </div>
              <div className="mcc-field">
                <label htmlFor="revision-after">Стало</label>
                <Select id="revision-after" width="max"
                  value={[String(b)]}
                  options={options}
                  onUpdate={([v]) => setRight(Number(v))}
                />
              </div>
            </div>
            {changed.length ? (
              <ul className="history-comparison">{changed.map((k) => (
                <li key={k}>
                  <strong>{historyFields[k]}</strong>: {historyValue(k, from[k])} → {historyValue(k, to[k])}
                </li>
              ))}</ul>
            ) : (
              <p>Значения совпадают.</p>
            )}
          </div>
        </details>
      )}
      {history?.status === 'loading' && <Text role="status" color="secondary">Загружаем историю изменений…</Text>}
      {history?.status === 'error' && <Text role="status" color="secondary">{history.error}</Text>}
      {(mode !== 'api' || history?.status === 'ready') && !revisions.length && !facts.length && (
        <Text color="secondary">В источнике пока нет записей об изменениях.</Text>
      )}
      <ol className="incident-list history-list">
        {facts.map((fact) => (
          <li key={fact.id} className="history-entry">
            <Flex direction="column" gap="spacing-1">
              <Text as="time" variant="subheader-2" dateTime={fact.at === undefined ? undefined : new Date(fact.at).toISOString()}>
                {fact.at === undefined ? 'Время не указано' : fullTime(fact.at)}
              </Text>
              <Text>{fact.label}</Text>
              {fact.observedAt !== undefined && fact.observedAt !== fact.changedAt && (
                <Text variant="caption-2" color="secondary">
                  {fact.changedAt === undefined ? 'Время наблюдения' : 'Замечено в ' + fullTime(fact.observedAt)}
                </Text>
              )}
            </Flex>
            <ChangeFields changes={fact.changes}/>
          </li>
        ))}
        {revisions.map((revision, index) => (
          <li key={revision.observedAt + '-' + index} className="history-entry">
            <Flex direction="column" gap="spacing-1">
              <Text as="time" variant="subheader-2">
                {stamp(revision.changedAt ?? revision.observedAt)}
              </Text>
              <Text variant="caption-2" color="secondary">
                {revision.changedAt ? 'Изменено' : 'Замечено дашбордом'}
              </Text>
              {revision.changedAt && revision.changedAt !== revision.observedAt && (
                <Text variant="caption-2" color="secondary">
                  Замечено в {stamp(revision.observedAt)}
                </Text>
              )}
            </Flex>
            <ChangeFields changes={revision.changes}/>
          </li>
        ))}
        {registeredAt !== undefined && Number.isFinite(registeredAt) && (
          <li className="history-entry">
            <Text as="time" variant="subheader-2" dateTime={new Date(registeredAt).toISOString()}>{fullTime(registeredAt)}</Text>
            <Text>Регистрация инцидента</Text>
          </li>
        )}
      </ol>
    </Card>
  )
}
