import {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react'
import {
  ArrowsExpand,
  ArrowRight,
  CircleExclamation,
  GraphNode,
  Lock,
  Minus,
  Plus,
} from '@gravity-ui/icons'
import {
  Button,
  Card,
  Flex,
  Icon,
  Label,
  Link,
  Loader,
  Text,
  useTheme,
} from '@gravity-ui/uikit'
import {
  EAnchorType,
  ECanChangeBlockGeometry,
  ECanDrag,
  GraphState,
  type Graph,
  type TAnchor,
  type TBlock,
  type TConnection,
} from '@gravity-ui/graph'
import {GraphBlock, GraphCanvas, useGraph, useSignal} from '@gravity-ui/graph/react'
import type {
  IncidentRelationshipNode,
  IncidentRelationshipsResponse,
} from '../../../entities/incident/model/api-types.ts'
import {ApiError} from '../../../shared/api/http.ts'
import {incidentsApi} from '../api/client.ts'
import {
  buildIncidentRelationshipGraph,
  relationshipPriorityLabel,
  relationshipStateLabel,
  type IncidentRelationshipGraph,
} from '../model/incidentRelationships.ts'
import './IncidentRelationships.css'

type RelationshipsState =
  | {status: 'loading'; incidentId: string}
  | {status: 'error'; incidentId: string; message: string}
  | {status: 'ready'; incidentId: string; response: IncidentRelationshipsResponse}

type RelationshipTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

type RelationshipBlock = TBlock

const NODE_WIDTH = 236
const NODE_HEIGHT = 136
const COLUMN_GAP = 88
const ROW_GAP = 28
const MAX_ROWS_PER_COLUMN = 3
const FIT_PADDING = 32

function detailHref(id: string, source?: string): string {
  const query = source === 'case' || source === 'volume' ? `?source=${source}` : ''
  return `/incidents/${encodeURIComponent(id)}${query}`
}

function relationshipTone(node: IncidentRelationshipNode): RelationshipTone {
  if (node.stateEnum === 'Resolved' || node.stateEnum === 'Closed') return 'success'
  if (node.stateEnum === 'Research') return 'warning'
  if (node.stateEnum === 'WorkInProgress' || node.stateEnum === 'Assigned') return 'info'
  return 'neutral'
}

function relationshipRole(
  nodeId: string,
  graph: IncidentRelationshipGraph,
): string {
  if (nodeId === graph.focus.id) return 'Текущий инцидент'
  if (graph.parents.some((item) => item.node.id === nodeId)) return 'Родительский инцидент'
  return 'Дочерний инцидент'
}

function incidentTitle(node: IncidentRelationshipNode): string {
  return node.title ?? 'Заголовок недоступен'
}

function RelationshipStatus({node}: {node: IncidentRelationshipNode}) {
  const tone = relationshipTone(node)
  return (
    <span className={`relationship-status relationship-status_${tone}`}>
      <span className="relationship-status-dot" aria-hidden="true" />
      {relationshipStateLabel(node.stateEnum)}
    </span>
  )
}

function sidePositions(count: number, direction: -1 | 1) {
  return Array.from({length: count}, (_, index) => {
    const column = Math.floor(index / MAX_ROWS_PER_COLUMN)
    const row = index % MAX_ROWS_PER_COLUMN
    const rowsInColumn = Math.min(MAX_ROWS_PER_COLUMN, count - column * MAX_ROWS_PER_COLUMN)
    const columnHeight = rowsInColumn * NODE_HEIGHT + Math.max(0, rowsInColumn - 1) * ROW_GAP
    const x =
      direction === -1
        ? -NODE_WIDTH / 2 - COLUMN_GAP - NODE_WIDTH - column * (NODE_WIDTH + COLUMN_GAP)
        : NODE_WIDTH / 2 + COLUMN_GAP + column * (NODE_WIDTH + COLUMN_GAP)
    return {
      x,
      y: -columnHeight / 2 + row * (NODE_HEIGHT + ROW_GAP),
    }
  })
}

function anchor(id: string, blockId: string, type: EAnchorType): TAnchor {
  return {id, blockId, type, index: 0}
}

function blockFor(
  node: IncidentRelationshipNode,
  x: number,
  y: number,
  anchors: TAnchor[],
): RelationshipBlock {
  return {
    is: 'block-action',
    id: node.id,
    x,
    y,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    name: incidentTitle(node),
    anchors,
    selected: false,
  }
}

function buildGraphEntities(graph: IncidentRelationshipGraph) {
  const blocks: RelationshipBlock[] = []
  const connections: TConnection[] = []
  const focusId = graph.focus.id

  blocks.push(
    blockFor(
      graph.focus,
      -NODE_WIDTH / 2,
      -NODE_HEIGHT / 2,
      [
        anchor(`${focusId}-in`, focusId, EAnchorType.IN),
        anchor(`${focusId}-out`, focusId, EAnchorType.OUT),
      ],
    ),
  )

  const parents = sidePositions(graph.parents.length, -1)
  graph.parents.forEach(({node}, index) => {
    const position = parents[index]
    const anchorId = `${node.id}-out`
    blocks.push(
      blockFor(
        node,
        position.x,
        position.y,
        [anchor(anchorId, node.id, EAnchorType.OUT)],
      ),
    )
    connections.push({
      id: `${node.id}->${focusId}`,
      sourceBlockId: node.id,
      sourceAnchorId: anchorId,
      targetBlockId: focusId,
      targetAnchorId: `${focusId}-in`,
    })
  })

  const children = sidePositions(graph.children.length, 1)
  graph.children.forEach(({node}, index) => {
    const position = children[index]
    const anchorId = `${node.id}-in`
    blocks.push(
      blockFor(
        node,
        position.x,
        position.y,
        [anchor(anchorId, node.id, EAnchorType.IN)],
      ),
    )
    connections.push({
      id: `${focusId}->${node.id}`,
      sourceBlockId: focusId,
      sourceAnchorId: `${focusId}-out`,
      targetBlockId: node.id,
      targetAnchorId: anchorId,
    })
  })

  return {blocks, connections}
}

function GraphNodeButton({
  node,
  graph,
  selected,
  detailsId,
  onSelect,
}: {
  node: IncidentRelationshipNode
  graph: IncidentRelationshipGraph
  selected: boolean
  detailsId: string
  onSelect: (id: string) => void
}) {
  const current = node.id === graph.focus.id
  const role = relationshipRole(node.id, graph)
  return (
    <button
      type="button"
      className={
        'relationship-node' +
        (current ? ' relationship-node_current' : '')
      }
      data-tone={relationshipTone(node)}
      data-current={current}
      aria-pressed={selected}
      aria-controls={detailsId}
      aria-label={`${selected ? 'Выбран' : 'Выбрать'}: ${role.toLowerCase()} ${node.id}. ${incidentTitle(node)}`}
      onClick={() => onSelect(node.id)}
    >
      <span className="relationship-node-top">
        <Text variant="code-1" color="secondary">
          {node.id}
        </Text>
        {current ? (
          <Label size="s" theme="info">
            Текущий
          </Label>
        ) : null}
      </span>
      <Text as="span" variant="subheader-1" className="relationship-node-title">
        {incidentTitle(node)}
      </Text>
      <span className="relationship-node-footer">
        <RelationshipStatus node={node} />
        <Text variant="caption-2" color="secondary">
          {relationshipPriorityLabel(node.priorityId)}
        </Text>
      </span>
    </button>
  )
}

function ZoomValue({graph}: {graph: Graph}) {
  const camera = useSignal(graph.$camera)
  return (
    <output className="relationship-zoom" aria-live="polite">
      {Math.round(camera.scale * 100)}%
    </output>
  )
}

function RelationshipCanvas({
  graph,
  selectedId,
  detailsId,
  onSelect,
}: {
  graph: IncidentRelationshipGraph
  selectedId: string
  detailsId: string
  onSelect: (id: string) => void
}) {
  const theme = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const fitDoneRef = useRef(false)
  const [ready, setReady] = useState(false)

  const config = useMemo(
    () => ({
      settings: {
        canDragCamera: true,
        canZoomCamera: true,
        canDrag: ECanDrag.NONE,
        canChangeBlockGeometry: ECanChangeBlockGeometry.NONE,
        canCreateNewConnections: false,
        canDuplicateBlocks: false,
        showConnectionArrows: true,
        useBezierConnections: true,
        bezierConnectionDirection: 'horizontal' as const,
        useBlocksAnchors: false,
        showConnectionLabels: false,
      },
      viewConfiguration: {
        constants: {
          block: {
            SCALES: [0.16, 0.3, 0.58] as [number, number, number],
          },
        },
      },
    }),
    [],
  )

  const {graph: canvasGraph, setEntities, start} = useGraph(config)

  const entities = useMemo(() => buildGraphEntities(graph), [graph])
  const nodesById = useMemo(() => {
    const nodes = new Map<string, IncidentRelationshipNode>()
    nodes.set(graph.focus.id, graph.focus)
    for (const {node} of graph.parents) nodes.set(node.id, node)
    for (const {node} of graph.children) nodes.set(node.id, node)
    return nodes
  }, [graph])

  const applyColors = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const styles = getComputedStyle(host)
    const color = (name: string) => styles.getPropertyValue(name).trim() || 'transparent'

    canvasGraph.setColors({
      canvas: {
        belowLayerBackground: color('--relationship-canvas-bg'),
        layerBackground: color('--relationship-canvas-bg'),
        dots: color('--relationship-canvas-dots'),
        border: color('--relationship-canvas-border'),
      },
      block: {
        background: color('--relationship-node-bg'),
        border: color('--relationship-node-border'),
        text: color('--relationship-node-text'),
        selectedBorder: color('--relationship-node-selected-border'),
      },
      anchor: {
        background: color('--relationship-connection'),
        selectedBorder: color('--relationship-connection-selected'),
      },
      connection: {
        background: color('--relationship-connection'),
        selectedBackground: color('--relationship-connection-selected'),
      },
    })
  }, [canvasGraph])

  useEffect(() => {
    setEntities(entities)
  }, [entities, setEntities])

  useEffect(() => {
    applyColors()
  }, [applyColors, theme])

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  const handleStateChanged = useCallback(
    ({state}: {state: GraphState}) => {
      if (state !== GraphState.ATTACHED) return
      applyColors()
      canvasGraph.cameraService.set({scaleMin: 0.08, scaleMax: 1.7})
      start()
      if (fitDoneRef.current) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        fitDoneRef.current = true
        canvasGraph.zoomTo('center', {padding: FIT_PADDING})
        setReady(true)
      })
    },
    [applyColors, canvasGraph, start],
  )

  const scaleBy = (factor: number) => {
    canvasGraph.zoom({
      scale: canvasGraph.cameraService.getCameraScale() * factor,
    })
  }

  const fit = () => {
    canvasGraph.zoomTo('center', {padding: FIT_PADDING})
  }

  const renderBlock = useCallback(
    (_canvas: Graph, block: TBlock) => {
      const node = nodesById.get(String(block.id))
      if (!node) {
        return (
          <GraphBlock graph={canvasGraph} block={block}>
            <span />
          </GraphBlock>
        )
      }
      return (
        <GraphBlock
          graph={canvasGraph}
          block={block}
          className="relationship-graph-block"
        >
          <GraphNodeButton
            node={node}
            graph={graph}
            selected={selectedId === node.id}
            detailsId={detailsId}
            onSelect={onSelect}
          />
        </GraphBlock>
      )
    },
    [canvasGraph, detailsId, graph, nodesById, onSelect, selectedId],
  )

  return (
    <div className="relationship-canvas-host" ref={hostRef}>
      <GraphCanvas
        graph={canvasGraph}
        renderBlock={renderBlock}
        className="relationship-canvas"
        onStateChanged={handleStateChanged}
      />
      <div className="relationship-board-label">
        <Text variant="caption-2" color="secondary">
          Родитель
        </Text>
        <Icon data={ArrowRight} size={14} />
        <Text variant="caption-2" color="secondary">
          Дочерний
        </Text>
      </div>
      <div className="relationship-controls" role="group" aria-label="Масштаб графа">
        <Button
          view="flat"
          size="s"
          title="Уменьшить"
          aria-label="Уменьшить масштаб"
          disabled={!ready}
          onClick={() => scaleBy(0.8)}
        >
          <Icon data={Minus} />
        </Button>
        <Button
          view="flat"
          size="s"
          title="Увеличить"
          aria-label="Увеличить масштаб"
          disabled={!ready}
          onClick={() => scaleBy(1.25)}
        >
          <Icon data={Plus} />
        </Button>
        <Button
          view="flat"
          size="s"
          title="Показать весь граф"
          aria-label="Показать весь граф"
          disabled={!ready}
          onClick={fit}
        >
          <Icon data={ArrowsExpand} />
        </Button>
        <ZoomValue graph={canvasGraph} />
      </div>
    </div>
  )
}

function RelationshipDetails({
  graph,
  selected,
  source,
  detailsId,
}: {
  graph: IncidentRelationshipGraph
  selected: IncidentRelationshipNode
  source?: string
  detailsId: string
}) {
  const current = selected.id === graph.focus.id
  const role = relationshipRole(selected.id, graph)
  const tone = relationshipTone(selected)

  return (
    <aside
      id={detailsId}
      className="relationship-details"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Подробности выбранного инцидента"
    >
      <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap>
        <span className={`relationship-role relationship-role_${tone}`}>{role}</span>
      </Flex>
      <Text variant="code-1" color="secondary">
        {selected.id}
      </Text>
      <Text as="h3" variant="header-1" className="relationship-detail-title">
        {incidentTitle(selected)}
      </Text>
      <dl className="relationship-detail-fields">
        <div>
          <dt>Статус</dt>
          <dd>
            <RelationshipStatus node={selected} />
          </dd>
        </div>
        <div>
          <dt>Приоритет</dt>
          <dd>{relationshipPriorityLabel(selected.priorityId)}</dd>
        </div>
      </dl>
      {current ? (
        <Text color="secondary" variant="caption-2">
          Родителей: {graph.parents.length} · Дочерних: {graph.children.length}
        </Text>
      ) : (
        <Link
          href={detailHref(selected.id, source)}
          className="relationship-open-link"
          aria-label={`Открыть инцидент ${selected.id} в карточке`}
        >
          Открыть {selected.id} в карточке
          <Icon data={ArrowRight} size={16} />
        </Link>
      )}
    </aside>
  )
}

function RelationshipList({
  graph,
  selectedId,
  detailsId,
  onSelect,
}: {
  graph: IncidentRelationshipGraph
  selectedId: string
  detailsId: string
  onSelect: (id: string) => void
}) {
  const items = useMemo(
    () => [
      ...graph.parents.map(({node}) => ({node, role: 'Родительский инцидент'})),
      {node: graph.focus, role: 'Текущий инцидент'},
      ...graph.children.map(({node}) => ({node, role: 'Дочерний инцидент'})),
    ],
    [graph],
  )

  return (
    <details className="relationship-list-disclosure">
      <summary>
        <Text as="span" variant="subheader-1">
          Список связей
        </Text>
        <Text as="span" color="secondary" variant="caption-2">
          {items.length}
        </Text>
      </summary>
      <ul className="relationship-list" aria-label="Связанные инциденты">
        {items.map(({node, role}) => (
          <li key={node.id}>
            <button
              type="button"
              className={
                'relationship-list-button' +
                (node.id === graph.focus.id ? ' relationship-list-button_current' : '')
              }
              data-tone={relationshipTone(node)}
              aria-pressed={selectedId === node.id}
              aria-controls={detailsId}
              onClick={() => onSelect(node.id)}
            >
              <span className="relationship-list-top">
                <Text variant="code-1" color="secondary">
                  {node.id}
                </Text>
                {node.id === graph.focus.id ? (
                  <Label size="s" theme="info">
                    Текущий
                  </Label>
                ) : null}
              </span>
              <Text as="span" variant="subheader-2" className="relationship-list-title">
                {incidentTitle(node)}
              </Text>
              <span className="relationship-list-meta">
                <RelationshipStatus node={node} />
                <Text variant="caption-2" color="secondary">
                  {role}
                </Text>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

function RelationshipGraphView({
  graph,
  source,
}: {
  graph: IncidentRelationshipGraph
  source?: string
}) {
  const detailsId = useId()
  const [selectedId, setSelectedId] = useState(graph.focus.id)

  const allNodes = useMemo(
    () => [
      ...graph.parents.map(({node}) => node),
      graph.focus,
      ...graph.children.map(({node}) => node),
    ],
    [graph],
  )
  const selected =
    allNodes.find((node) => node.id === selectedId) ?? graph.focus

  return (
    <div className="relationship-graph-view">
      <div className="relationship-workspace">
        <div className="relationship-board">
          <RelationshipCanvas
            graph={graph}
            selectedId={selected.id}
            detailsId={detailsId}
            onSelect={setSelectedId}
          />
        </div>
        <RelationshipDetails
          graph={graph}
          selected={selected}
          source={source}
          detailsId={detailsId}
        />
      </div>
      <RelationshipList
        graph={graph}
        selectedId={selected.id}
        detailsId={detailsId}
        onSelect={setSelectedId}
      />
      <footer className="relationship-footer">
        <Text color="secondary" variant="caption-2">
          Выберите узел, чтобы увидеть детали. Колесо мыши — масштаб, перетаскивание — панорама.
        </Text>
      </footer>
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
  const [state, setState] = useState<RelationshipsState>({
    status: 'loading',
    incidentId,
  })

  useEffect(() => {
    const controller = new AbortController()

    void incidentsApi
      .getIncidentRelationships(incidentId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setState({status: 'ready', incidentId, response})
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message =
          error instanceof ApiError && error.status === 404
            ? `Инцидент ${incidentId} не найден.`
            : error instanceof Error
              ? error.message
              : 'Не удалось загрузить связанные инциденты.'
        setState({status: 'error', incidentId, message})
      })

    return () => controller.abort()
  }, [attempt, incidentId])

  // Never render a response from the previous card while the next request starts.
  const viewState: RelationshipsState =
    state.incidentId === incidentId
      ? state
      : {status: 'loading', incidentId}

  const graph =
    viewState.status === 'ready'
      ? buildIncidentRelationshipGraph(viewState.response, incidentId)
      : null
  const hasRelations = Boolean(graph && (graph.parents.length > 0 || graph.children.length > 0))
  const graphKey = graph
    ? [graph.focus.id, ...graph.parents.map(({node}) => node.id), ...graph.children.map(({node}) => node.id)].join('|')
    : ''

  return (
    <Card
      className="mcc-glass incident-panel incident-relationships"
      aria-labelledby={titleId}
      aria-busy={viewState.status === 'loading'}
    >
      <Flex alignItems="flex-start" justifyContent="space-between" gap="spacing-2" wrap>
        <div className="incident-relationships-heading">
          <span className="incident-relationships-mark" aria-hidden="true">
            <Icon data={GraphNode} size={22} />
          </span>
          <div className="incident-relationships-titles">
            <Text as="h2" id={titleId} variant="header-1">
              Связанные инциденты
            </Text>
            <Text color="secondary" variant="body-1">
              Прямая иерархия из ITSM
            </Text>
          </div>
        </div>
        <Label size="s" theme="utility">
          <Flex alignItems="center" gap="spacing-1">
            <Icon data={Lock} size={14} />
            Только просмотр
          </Flex>
        </Label>
      </Flex>

      {viewState.status === 'loading' ? (
        <div className="incident-relationships-state" role="status" aria-live="polite">
          <Loader size="s" />
          <Text color="secondary">Загружаем связанные инциденты…</Text>
        </div>
      ) : null}

      {viewState.status === 'error' ? (
        <div className="incident-relationships-state" role="alert">
          <Flex alignItems="center" gap="spacing-2">
            <Icon data={CircleExclamation} size={16} className="incident-relationships-error-icon" />
            <Text color="danger">
              Не удалось загрузить связанные инциденты: {viewState.message}
            </Text>
          </Flex>
          <Button
            size="s"
            view="outlined"
            onClick={() => {
              setState({status: 'loading', incidentId})
              setAttempt((value) => value + 1)
            }}
          >
            Повторить
          </Button>
        </div>
      ) : null}

      {viewState.status === 'ready' && graph && !hasRelations ? (
        <div className="incident-relationships-state" role="status">
          <Text color="secondary">Нет связанных инцидентов</Text>
        </div>
      ) : null}

      {viewState.status === 'ready' && graph && hasRelations ? (
        <RelationshipGraphView key={`${incidentId}:${graphKey}`} graph={graph} source={source} />
      ) : null}
    </Card>
  )
}
