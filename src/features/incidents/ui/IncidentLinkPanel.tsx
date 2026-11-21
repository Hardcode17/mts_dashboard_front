import {useEffect, useId, useState, type FormEvent} from 'react'
import {Button, Flex, getConfig, Link, Select, Text, TextInput} from '@gravity-ui/uikit'
import type {ConfirmedIncidentLink, IncidentLinkKind} from '../../../entities/incident/model/api-types'
import {ApiError} from '../../../shared/api/http'
import {incidentsApi} from '../api/client'
import {confirmedLinkForCard, upsertConfirmedLink} from '../model/confirmedLinks'
import {confirmedLinkMessages} from './confirmedLinkMessages'
import {SimilarIncidents} from './SimilarIncidents'

const linkKinds: IncidentLinkKind[] = ['related_to', 'causes', 'duplicate_of']

export function IncidentLinkPanel({number, initialLinks}: {
  number: string
  initialLinks?: ConfirmedIncidentLink[]
}) {
  const lang = getConfig().lang === 'ru' ? 'ru' : 'en'
  const copy = confirmedLinkMessages[lang]
  const [links, setLinks] = useState(initialLinks)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [target, setTarget] = useState('')
  const [kind, setKind] = useState<IncidentLinkKind>('related_to')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const targetId = useId()
  const kindId = useId()

  useEffect(() => {
    if (initialLinks !== undefined) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
    void incidentsApi.getIncident(number, signal).then(
      detail => {if (!controller.signal.aborted) setLinks(detail.confirmedLinks)},
      () => {if (!controller.signal.aborted) setLoadFailed(true)},
    )
    return () => controller.abort()
  }, [number, initialLinks, attempt])

  function selectTarget(value: string) {
    setTarget(value)
    setError('')
    setSaved(false)
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || links === undefined) return
    const other = target.trim().toUpperCase()
    setError('')
    setSaved(false)
    if (!/^INC[0-9]{6,18}$/.test(other) || other === number) {
      setError(copy.invalid)
      return
    }
    setBusy(true)
    try {
      const link = await incidentsApi.confirmIncidentLink(number, other, kind, AbortSignal.timeout(10000))
      setLinks(previous => upsertConfirmedLink(previous ?? [], link))
      setTarget('')
      setSaved(true)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) setError(copy.missing)
      else if (cause instanceof ApiError && cause.status === 400) setError(copy.invalid)
      else setError(copy.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  const dates = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', {
    timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short',
  })

  return <div className="desk-stack">
    <Text as="h3" variant="subheader-2">{copy.title}</Text>
    {loadFailed ? <Flex gap="spacing-2" wrap>
      <Text role="alert" color="danger">{copy.loadFailed}</Text>
      <Button onClick={() => {setLoadFailed(false); setAttempt(value => value + 1)}}>{copy.retry}</Button>
    </Flex> : links === undefined ? <Text role="status">{copy.loading}</Text> : <>
      {links.length ? <ul className="desk-list">
        {links.map(link => {
          const viewed = confirmedLinkForCard(link, number)
          if (!viewed) return null
          return <li key={link.id}>
            <Flex alignItems="center" gap="spacing-2" wrap>
              <Text>{copy[viewed.direction][link.kind]}</Text>
              <Link href={'/incidents/' + encodeURIComponent(viewed.other)}>{viewed.other}</Link>
            </Flex>
            <Text color="secondary">{copy.author(link.confirmedByUserId)} · {dates.format(new Date(link.createdAt))}</Text>
          </li>
        })}
      </ul> : <Text color="secondary">{copy.empty}</Text>}
      <form className="desk-stack" onSubmit={event => void confirm(event)}>
        <div className="mcc-field">
          <label htmlFor={targetId}>{copy.target}</label>
          <TextInput id={targetId} value={target} onUpdate={selectTarget} disabled={busy}/>
        </div>
        <div className="mcc-field">
          <label htmlFor={kindId}>{copy.kind}</label>
          <Select id={kindId} value={[kind]} options={linkKinds.map(value => ({value, content: copy.outgoing[value]}))}
            onUpdate={([value]) => setKind(value as IncidentLinkKind)} disabled={busy} width="max"/>
        </div>
        <Flex>
          <Button type="submit" view="action" disabled={busy || !target.trim()} loading={busy}>{copy.confirm}</Button>
        </Flex>
        {error && <Text role="alert" color="danger">{error}</Text>}
        {saved && <Text role="status" color="positive">{copy.saved}</Text>}
      </form>
    </>}
    <SimilarIncidents number={number} onSelect={links && !busy ? selectTarget : undefined}/>
  </div>
}
