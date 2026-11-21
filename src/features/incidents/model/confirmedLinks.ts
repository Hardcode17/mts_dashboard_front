import type {ConfirmedIncidentLink, IncidentNumber} from '../../../entities/incident/model/api-types.ts'

export function confirmedLinkForCard(link: ConfirmedIncidentLink, incidentId: IncidentNumber) {
  if (link.sourceIncidentId === incidentId) {
    return {other: link.targetIncidentId, direction: 'outgoing'} as const
  }
  if (link.targetIncidentId === incidentId) {
    return {other: link.sourceIncidentId, direction: 'incoming'} as const
  }
}

export function upsertConfirmedLink(links: ConfirmedIncidentLink[], confirmed: ConfirmedIncidentLink) {
  return links.some(link => link.id === confirmed.id)
    ? links.map(link => link.id === confirmed.id ? confirmed : link)
    : [...links, confirmed]
}
