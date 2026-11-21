import assert from 'node:assert/strict'
import test from 'node:test'
import {createServer} from 'node:http'
import {createIncidentsApi} from '../src/features/incidents/api/client.ts'
import {
  buildIncidentRelationshipGraph,
  relationshipPriorityLabel,
  relationshipStateLabel,
} from '../src/features/incidents/model/incidentRelationships.ts'
import {ApiError} from '../src/shared/api/http.ts'

const parent = {
  id: 'INC-PARENT',
  title: 'Родительский инцидент',
  stateEnum: 'WorkInProgress',
  priorityId: 3,
}
const child = {
  id: 'INC-CHILD',
  title: 'Дочерний инцидент',
  stateEnum: 'Assigned',
  priorityId: 4,
}
const sibling = {
  id: 'INC-SIBLING',
  title: 'Второй дочерний инцидент',
  stateEnum: 'Assigned',
  priorityId: 2,
}
const edges = [
  {parentId: 'INC-PARENT', childId: 'INC-CHILD'},
  {parentId: 'INC-PARENT', childId: 'INC-SIBLING'},
]

test('the relationships client encodes the external incident number and reads the agreed shape', async () => {
  const requests = []
  const server = createServer((request, response) => {
    requests.push(request.url)
    response.writeHead(200, {'Content-Type': 'application/json'})
    response.end(
      JSON.stringify({focusId: 'INC 1/2', nodes: [child], edges: []}),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const api = createIncidentsApi({baseUrl: `http://127.0.0.1:${server.address().port}`})

  try {
    const response = await api.getIncidentRelationships('INC 1/2')
    assert.deepEqual(response, {focusId: 'INC 1/2', nodes: [child], edges: []})
    assert.deepEqual(requests, ['/api/incidents/INC%201%2F2/relationships'])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('the relationships client keeps the existing API error shape', async () => {
  const server = createServer((request, response) => {
    response.writeHead(404, {'Content-Type': 'application/json'})
    response.end(
      JSON.stringify({code: 'RESOURCE_NOT_FOUND', message: 'Incident not found'}),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const api = createIncidentsApi({baseUrl: `http://127.0.0.1:${server.address().port}`})

  try {
    await assert.rejects(api.getIncidentRelationships('INC-MISSING'), (error) => {
      assert(error instanceof ApiError)
      assert.equal(error.status, 404)
      assert.equal(error.code, 'RESOURCE_NOT_FOUND')
      return true
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('the graph keeps direct parents and children around the focus node', () => {
  const childGraph = buildIncidentRelationshipGraph(
    {
      focusId: child.id,
      nodes: [parent, child, sibling, {id: 'INC-GRANDPARENT', title: null, stateEnum: null, priorityId: null}],
      edges: [
        ...edges,
        {parentId: 'INC-GRANDPARENT', childId: parent.id},
        {parentId: 'INC-PARENT', childId: child.id},
      ],
    },
    child.id,
  )

  assert.equal(childGraph.focus.id, child.id)
  assert.deepEqual(childGraph.parents.map((item) => item.node.id), ['INC-PARENT'])
  assert.deepEqual(childGraph.children, [])

  const parentGraph = buildIncidentRelationshipGraph(
    {focusId: parent.id, nodes: [parent, child, sibling], edges},
    parent.id,
  )
  assert.equal(parentGraph.focus.id, parent.id)
  assert.deepEqual(parentGraph.parents, [])
  assert.deepEqual(parentGraph.children.map((item) => item.node.id), ['INC-CHILD', 'INC-SIBLING'])
})

test('the graph returns the empty state for a known unrelated incident and tolerates missing node fields', () => {
  const unrelated = buildIncidentRelationshipGraph(
    {focusId: child.id, nodes: [child], edges: []},
    child.id,
  )
  assert.deepEqual(unrelated.parents, [])
  assert.deepEqual(unrelated.children, [])

  const sparse = buildIncidentRelationshipGraph(
    {
      focusId: '',
      nodes: [{id: 'INC-FOCUS', title: null, stateEnum: null, priorityId: null}],
      edges: [{parentId: 'INC-UNKNOWN', childId: 'INC-FOCUS'}],
    },
    'INC-FOCUS',
  )
  assert.equal(sparse.focus.id, 'INC-FOCUS')
  assert.equal(sparse.parents[0].node.id, 'INC-UNKNOWN')
  assert.equal(sparse.parents[0].node.title, null)

  assert.equal(relationshipStateLabel(null), 'Статус не указан')
  assert.equal(relationshipStateLabel('Research'), 'Исследование ситуации')
  assert.equal(relationshipPriorityLabel(null), 'Приоритет не указан')
  assert.equal(relationshipPriorityLabel(4), 'Наивысший')
})
