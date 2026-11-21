import {useEffect, useState} from 'react'
import {Button, Link, Text} from '@gravity-ui/uikit'
import type {SimilarIncidentsResponse} from '../../../entities/incident/model/api-types'
import {incidentsApi} from '../api/client'

export function SimilarIncidents({number}: {number: string}) {
  const [result, setResult] = useState<SimilarIncidentsResponse>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void incidentsApi.getSimilar(number, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))
      .then(response => {
        if (response.incidentId !== number) throw Error('Список относится к другому инциденту.')
        if (!controller.signal.aborted) setResult(response)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Ошибка чтения')
      })
    return () => controller.abort()
  }, [number, attempt])

  if (error) return <>
    <Text role="alert" color="danger">Не удалось загрузить похожие случаи из ITSM. {error}</Text>
    <Button onClick={() => {setError(''); setAttempt(value => value + 1)}}>Повторить</Button>
  </>
  if (!result) return <Text role="status">Ищем похожие инциденты в опубликованном снимке…</Text>
  if (!result.candidates.length) return <Text>В опубликованном снимке похожих случаев нет.</Text>
  return <ul className="desk-list">
    {result.candidates.map(candidate => <li key={candidate.incidentId}>
      <Link href={'/incidents/' + encodeURIComponent(candidate.incidentId)}>
        {candidate.incidentId}{candidate.header && ' · ' + candidate.header}
      </Link>
      <Text color="secondary">{candidate.reasons.join(' · ')}</Text>
    </li>)}
  </ul>
}
