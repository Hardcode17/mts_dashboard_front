export interface CoordinatorAvailability {
  available: boolean
  availableSince: string | null
  generation: number
  groups: {id: number; name: string}[]
}

export function isCoordinatorAvailability(value: unknown): value is CoordinatorAvailability {
  return value !== null && typeof value === 'object'
    && 'available' in value && typeof value.available === 'boolean'
    && 'availableSince' in value && (value.availableSince === null || typeof value.availableSince === 'string')
    && 'generation' in value && typeof value.generation === 'number' && Number.isSafeInteger(value.generation)
    && 'groups' in value && Array.isArray(value.groups)
    && value.groups.every(group => group && typeof group === 'object'
      && typeof group.id === 'number' && typeof group.name === 'string')
}
