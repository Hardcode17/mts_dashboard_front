import type {Report, Source} from './types'

export function isInvestigationReport(report: Report) {
  return Boolean(report.analysis) || report.title === 'Разбор агента'
}

export function investigationHref(key: string, dataset: Source, run?: string) {
  const query = new URLSearchParams()
  if (run !== undefined) query.set('run', run)
  query.set('dataset', dataset)
  return '#investigation/' + encodeURIComponent(key) + '?' + query
}
