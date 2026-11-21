import {itsmEnumForState, itsmStateLabels, type ItsmState, type QueueKey} from '../../../desk/types.ts'
import type {DashboardIncidentQuery} from '../../../entities/incident/model/dashboard-contract.ts'

const filterNames = ['q', 'priority', 'product', 'team', 'state', 'serviceType', 'deadline', 'sort'] as const

export function queueFilterKey(params: URLSearchParams) {
  const filters = new URLSearchParams()
  for (const name of filterNames) {
    const value = params.get(name)?.trim()
    if (value) filters.set(name, value)
  }
  return filters.toString()
}

export function queueFilterQuery(key: string, queue: QueueKey | 'all'): DashboardIncidentQuery {
  const filters = new URLSearchParams(key)
  const read = (name: typeof filterNames[number]) => filters.get(name) || undefined
  const priority = Number(read('priority'))
  const state = read('state')
  const deadline = read('deadline')
  const sort = read('sort')
  return {
    group: queue === 'all' ? undefined : [queue === 'assigned' ? 'coordinator' : queue],
    q: read('q'),
    priority: priority === 1 || priority === 2 || priority === 3 || priority === 4 ? priority : undefined,
    product: read('product'),
    team: read('team'),
    state: state && Object.hasOwn(itsmStateLabels, state) ? state as ItsmState : itsmEnumForState(state ?? ''),
    serviceType: read('serviceType'),
    deadline: deadline === 'none' || deadline === 'late' || deadline === 'near' ? deadline : undefined,
    sort: sort === 'updated' || sort === 'registered' ? sort : 'deadline',
  }
}
