import {useEffect, useId, useState} from 'react'
import {ArrowDown, CircleExclamation} from '@gravity-ui/icons'
import {Button, Card, Flex, Icon, Label, Link, Loader, Text} from '@gravity-ui/uikit'
import type {IncidentRelationshipsResponse} from '../../../entities/incident/model/api-types.ts'
import {ApiError} from '../../../shared/api/http.ts'
import {incidentsApi} from '../api/client.ts'
import {
  buildIncidentRelationshipGraph,
  relationshipPriorityLabel,
  relationshipStateLabel,
  type IncidentRelationshipGraph,
  type RelationshipNeighbor,
} from '../model/incidentRelationships.ts'
import './IncidentRelationships.css'

type RelationshipsState =
  | {status: 'loading'}
  | {status: 'error'; message: string}
  | {status: 'ready'; response: IncidentRelationshipsResponse}

function detailHref(id: string, source?: string): string {
  const query = source === 'case' || source === 'volume' ? `?source=${source}` : ''
  return `/incidents/${encodeURIComponent(id)}${query}`
}

function stateTheme(state: string | null): 'normal' | 'success' | 'warning' {
  if (state === 'Resolved' || state === 'Closed') return 'success'
  if (state === 'Research') return 'warning'
  return 'normal'
}

function NodeCard({
  node,
  selected,
  source,
}: {
  node: IncidentRelationshipGraph['focus']
  selected: boolean
  source?: string
}) {
  const title = node.title ?? 'Заголовок недоступен'
  const content = (
    <>
      <Flex alignItems="center" gap="spacing-2" wrap>
        <Text variant="code-1">{node.id}</Text>
        {selected ? (
          <Label size="s" theme="info">
            Выбранный INC
          </Label>
        ) : null}
      </Flex>
      <Text as="span" variant="subheader-1" className="relationship-node-title">
        {title}
      </Text>
      <Flex alignItems="center" gap="spacing-2" wrap>
        <Label size="s" theme={stateTheme(node.stateEnum)}>
          {relationshipStateLabel(node.stateEnum)}
        </Label>
        <Text color="secondary" variant="caption-2">
          {relationshipPriorityLabel(node.priorityId)}
        </Text>
      </Flex>
    </>
  )

  if (selected) {
    return (
      <div
        className="relationship-node relationship-node_selected"
        aria-current="true"
        aria-label={`Выбранный инцидент ${node.id}: ${title}`}
      >
        {content}
      </div>
    )
  }

  return (
    <Link
      href={detailHref(node.id, source)}
      className="relationship-node relationship-node_link"
      aria-label={`Открыть инцидент ${node.id}: ${title}`}
    >
      {content}
    </Link>
  )
}

function Edge() {
  return (
    <div className="relationship-edge">
      <span className="relationship-edge-line" aria-hidden="true" />
      <Icon data={ArrowDown} size={14} className="relationship-edge-icon" />
      <Text variant="caption-2" color="secondary">
        родитель → дочерний
      </Text>
    </div>
  )
}

function NeighbourCard({
  neighbour,
  source,
}: {
  neighbour: RelationshipNeighbor
  source?: string
}) {
  return <NodeCard node={neighbour.node} selected={false} source={source} />
}

function RelationshipGraph({graph, source}: {graph: IncidentRelationshipGraph; source?: string}) {
  const id = useId()
  return (
    <div className="relationship-diagram">
      {graph.parents.length > 0 ? (
        <section className="relationship-group" aria-labelledby={`${id}-parents`}>
          <Text as="h3" id={`${id}-parents`} variant="subheader-1">
            Родительский инцидент
          </Text>
          <ol className="relationship-list">
            {graph.parents.map((neighbour) => (
              <li key={neighbour.node.id}>
                <NeighbourCard neighbour={neighbour} source={source} />
                <Edge />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="relationship-group" aria-labelledby={`${id}-focus`}>
        <Text as="h3" id={`${id}-focus`} variant="subheader-1">
          Текущий инцидент
        </Text>
        <NodeCard node={graph.focus} selected />
      </section>

      {graph.children.length > 0 ? (
        <section className="relationship-group" aria-labelledby={`${id}-children`}>
          <Text as="h3" id={`${id}-children`} variant="subheader-1">
            Дочерние инциденты
          </Text>
          <ol className="relationship-list">
            {graph.children.map((neighbour) => (
              <li key={neighbour.node.id}>
                <Edge />
                <NeighbourCard neighbour={neighbour} source={source} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}

export function IncidentRelationships({
  incidentId,
  source,
}: {
  incidentId: string
  source?: string
}) {
  const titleId = useId()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<RelationshipsState>({status: 'loading'})

  useEffect(() => {
    const controller = new AbortController()

    void incidentsApi
      .getIncidentRelationships(incidentId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setState({status: 'ready', response})
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message =
          error instanceof ApiError && error.status === 404
            ? `Инцидент ${incidentId} не найден.`
            : error instanceof Error
              ? error.message
              : 'Не удалось загрузить связанные инциденты.'
        setState({status: 'error', message})
      })

    return () => controller.abort()
  }, [attempt, incidentId])

  const graph =
    state.status === 'ready'
      ? buildIncidentRelationshipGraph(state.response, incidentId)
      : null
  const hasRelations = Boolean(graph && (graph.parents.length > 0 || graph.children.length > 0))

  return (
    <Card
      className="mcc-glass incident-panel incident-relationships"
      aria-labelledby={titleId}
      aria-busy={state.status === 'loading'}
    >
      <Flex alignItems="flex-start" justifyContent="space-between" gap="spacing-2" wrap>
        <div className="incident-relationships-heading">
          <Text as="h2" id={titleId} variant="header-1">
            Связанные инциденты
          </Text>
          <Text color="secondary" variant="body-1">
            Прямой родитель и дочерние инциденты. Режим просмотра.
          </Text>
        </div>
        <Label size="s" theme="utility">
          Только просмотр
        </Label>
      </Flex>

      {state.status === 'loading' ? (
        <div className="incident-relationships-state" role="status" aria-live="polite">
          <Loader size="s" />
          <Text color="secondary">Загружаем связанные инциденты…</Text>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="incident-relationships-state" role="alert">
          <Flex alignItems="center" gap="spacing-2">
            <Icon data={CircleExclamation} size={16} className="incident-relationships-error-icon" />
            <Text color="danger">
              Не удалось загрузить связанные инциденты: {state.message}
            </Text>
          </Flex>
          <Button
            size="s"
            view="outlined"
            onClick={() => {
              setState({status: 'loading'})
              setAttempt((value) => value + 1)
            }}
          >
            Повторить
          </Button>
        </div>
      ) : null}

      {state.status === 'ready' && graph && !hasRelations ? (
        <div className="incident-relationships-state" role="status">
          <Text color="secondary">Нет связанных инцидентов</Text>
        </div>
      ) : null}

      {state.status === 'ready' && graph && hasRelations ? (
        <RelationshipGraph graph={graph} source={source} />
      ) : null}
    </Card>
  )
}
