import {coordinatorGroup, type Desk} from '../src/desk/types.ts'
import {isCoordinatorAvailability, type CoordinatorAvailability} from '../src/entities/coordinator/model/availability.ts'
import {shiftAvailabilityMessages} from '../src/features/shift-availability/messages.ts'
import {createHttpClient, ApiError} from '../src/shared/api/http.ts'
import {ItsmError} from './itsm.ts'

export interface CoordinatorProfile {
  id: string
  name: string
  availability?: CoordinatorAvailability
}

export function syncCoordinator(desk: Desk, profile: CoordinatorProfile) {
  const person = desk.people.find(entry => entry.id === profile.id)
  const presence = profile.availability
  const stale = presence && person?.shiftGroups?.length && presence.groups.length
    && (person.generation > presence.generation
      || (person.generation === presence.generation && !person.available && presence.available))
  const current = stale ? undefined : presence
  const available = current?.available ?? person?.available ?? true
  const generation = current?.generation ?? person?.generation ?? 1
  const shiftGroups = current?.groups ?? person?.shiftGroups
  const previousGroups = person?.shiftGroups
  const sameGroups = shiftGroups === previousGroups || (shiftGroups && previousGroups
    && shiftGroups.length === previousGroups.length
    && shiftGroups.every((group, index) => group.id === previousGroups[index].id && group.name === previousGroups[index].name))

  if (person && person.name === profile.name && person.available === available
      && person.generation === generation && sameGroups) return false

  if (person) Object.assign(person, {name: profile.name, available, generation, shiftGroups})
  else desk.people.push({id: profile.id, name: profile.name, group: coordinatorGroup, available, generation, shiftGroups})
  return true
}

export async function saveCoordinatorAvailability(profileUrl: string, bearer: string, available: boolean) {
  const copy = shiftAvailabilityMessages.ru
  const client = createHttpClient({getAccessToken: () => bearer})
  let result: unknown
  try {
    result = await client.request<unknown>(profileUrl + '/availability', {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({available}), redirect: 'error',
    }, AbortSignal.timeout(5000))
  } catch (error) {
    const status = error instanceof ApiError && [401, 403].includes(error.status) ? error.status : 503
    throw new ItsmError(status, status === 403 ? copy.forbidden : copy.saveFailed)
  }
  if (!isCoordinatorAvailability(result)) throw new ItsmError(503, copy.loadFailed)
  return result
}
