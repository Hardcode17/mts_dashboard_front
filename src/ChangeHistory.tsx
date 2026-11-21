import {useState} from 'react'
import {historyValue} from './desk/timeline'
import {useWorkspace} from './desk/context'
import {fullTime, standNow} from './desk/types'
import {Card, Flex, Select, Text} from '@gravity-ui/uikit'
import {incidentRevisions, type Incident} from './demoData'
import {cardChanges, historyFields, type TrackedField} from './incidentHistory'

export function ChangeHistory({incident}: {incident: Incident}) {
  const {desk} = useWorkspace()
  const versions =
    desk.revisions[incident.key] ??
    (desk.mode === 'volume' ? incidentRevisions.get(incident.key) : undefined) ??
    []
  const revisions = cardChanges(versions)
  const stamp = (value: string, observed = false) => {
    if (!value.includes('T')) return value
    const at = Date.parse(value)
    return fullTime(observed ? standNow(desk, at) : at)
  }
  const [left, setLeft] = useState(0),
    [right, setRight] = useState(-1)
  const a = Math.min(left, versions.length - 1),
    b = right < 0 ? versions.length - 1 : Math.min(right, versions.length - 1)
  const snapshot = (n: number) => Object.assign({}, ...versions.slice(0, n + 1).map((v) => v.values))
  const from = snapshot(a),
    to = snapshot(b),
    options = versions.map((v, i) => ({
      value: String(i),
      content: '#' + (i + 1) + ' · ' + stamp(v.observedAt, true),
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
          <Flex gap="spacing-2" wrap>
            <Select
              label="Было"
              value={[String(a)]}
              options={options}
              onUpdate={([v]) => setLeft(Number(v))}
            />
            <Select
              label="Стало"
              value={[String(b)]}
              options={options}
              onUpdate={([v]) => setRight(Number(v))}
            />
          </Flex>
          {changed.length ? (
            changed.map((k) => (
              <p key={k}>
                <strong>{historyFields[k]}</strong>: {historyValue(k, from[k])} → {historyValue(k, to[k])}
              </p>
            ))
          ) : (
            <p>Значения совпадают.</p>
          )}
        </details>
      )}
      {revisions.length === 0 && (
        <Text color="secondary">В источнике пока нет записей об изменении полей.</Text>
      )}
      <ol className="incident-list history-list">
        {revisions.map((revision, index) => (
          <li key={revision.observedAt + '-' + index} className="history-entry">
            <Flex direction="column" gap="spacing-1">
              <Text as="time" variant="subheader-2">
                {stamp(revision.changedAt ?? revision.observedAt, !revision.changedAt)}
              </Text>
              <Text variant="caption-2" color="secondary">
                {revision.changedAt ? 'Изменено' : 'Замечено дашбордом'}
              </Text>
              {revision.changedAt && revision.changedAt !== revision.observedAt && (
                <Text variant="caption-2" color="secondary">
                  Замечено в {stamp(revision.observedAt, true)}
                </Text>
              )}
            </Flex>
            <div className="history-fields">
              {revision.changes.map((change) => (
                <div key={change.field}>
                  <Text as="h3" variant="subheader-2">
                    {historyFields[change.field]}
                  </Text>
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
          </li>
        ))}
        <li className="history-entry">
          <Text as="time" variant="subheader-2">
            {incident.registered}
          </Text>
          <Text>Регистрация инцидента</Text>
        </li>
      </ol>
    </Card>
  )
}
