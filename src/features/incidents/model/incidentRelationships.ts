import type {
  IncidentRelationshipEdge,
  IncidentRelationshipNode,
  IncidentRelationshipsResponse,
} from '../../../entities/incident/model/api-types.ts'

export interface RelationshipNeighbor {
  node: IncidentRelationshipNode
  edge: IncidentRelationshipEdge
}

export interface IncidentRelationshipGraph {
  focus: IncidentRelationshipNode
  parents: RelationshipNeighbor[]
  children: RelationshipNeighbor[]
}

const stateLabels: Record<string, string> = {
  Assigned: 'Назначен',
  WorkInProgress: 'В работе',
  Resolved: 'Завершён',
  Closed: 'Закрыт',
  Research: 'Исследование ситуации',
}

const priorityLabels = ['Низкий', 'Средний', 'Высокий', 'Наивысший'] as const

export function relationshipStateLabel(value: string | null | undefined): string {
  return value ? stateLabels[value] ?? value : 'Статус не указан'
}

export function relationshipPriorityLabel(value: number | null | undefined): string {
  return value == null ? 'Приоритет не указан' : priorityLabels[value - 1] ?? `Приоритет ${value}`
}

function emptyNode(id: string): IncidentRelationshipNode {
  return {id, title: null, stateEnum: null, priorityId: null}
}

/**
 * Keeps only the focus and direct neighbours. The API promises that shape, but
 * the graph is the UI boundary, so stale or duplicate edges cannot leak into it.
 */
export function buildIncidentRelationshipGraph(
  response: IncidentRelationshipsResponse,
  fallbackFocusId: string,
): IncidentRelationshipGraph {
  const nodes = new Map<string, IncidentRelationshipNode>()

  for (const node of response.nodes ?? []) {
    if (node && typeof node.id === 'string' && node.id) nodes.set(node.id, node)
  }

  const focusId = response.focusId || fallbackFocusId
  const focus = nodes.get(focusId) ?? emptyNode(focusId)
  const parents: RelationshipNeighbor[] = []
  const children: RelationshipNeighbor[] = []
  const seen = new Set<string>()

  for (const edge of response.edges ?? []) {
    if (!edge || !edge.parentId || !edge.childId || edge.parentId === edge.childId) continue

    const neighbourId =
      edge.childId === focusId
        ? edge.parentId
        : edge.parentId === focusId
          ? edge.childId
          : null
    if (!neighbourId) continue

    const key = `${edge.parentId}\u0000${edge.childId}`
    if (seen.has(key)) continue
    seen.add(key)

    const neighbour = {node: nodes.get(neighbourId) ?? emptyNode(neighbourId), edge}
    if (edge.childId === focusId) parents.push(neighbour)
    else children.push(neighbour)
  }

  return {focus, parents, children}
}
