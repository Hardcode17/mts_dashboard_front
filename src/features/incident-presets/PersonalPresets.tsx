import {useId, useState, type FormEvent} from 'react'
import {Button, getConfig, Link, Text, TextInput} from '@gravity-ui/uikit'
import {ApiError} from '../../shared/api/http'
import type {QueueKey} from '../../desk/types'
import {presetFromQueue, presetHref, type IncidentPreset} from './api'
import {incidentPresetMessages} from './messages'
import {useIncidentPresets} from './provider'

export function PersonalPresets({queue, params}: {queue: QueueKey | 'all'; params: URLSearchParams}) {
  const copy = incidentPresetMessages[getConfig().lang === 'ru' ? 'ru' : 'en']
  const {items, failed, retry, save, remove} = useIncidentPresets()
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<IncidentPreset | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const nameId = useId()

  function edit(preset: IncidentPreset | null) {
    setError('')
    setRenaming(preset)
    setName(preset?.name ?? '')
  }

  async function saveView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !name.trim()) return
    setError('')
    setBusy(true)
    const draft = renaming ? {...renaming, name: name.trim()} : presetFromQueue(name, queue, params)
    const id = renaming?.id ?? items?.find(item => item.name === draft.name)?.id
    try {
      await save(draft, id)
      edit(null)
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === 'INCIDENT_PRESET_NAME_EXISTS' ? copy.duplicate : copy.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  async function removeView(id: number) {
    setError('')
    setBusy(true)
    try {
      await remove(id)
    } catch {
      setError(copy.deleteFailed)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Text as="h3" variant="subheader-2">{copy.title}</Text>
    {failed ? <div className="queue-saved-preset">
      <Text role="alert" color="danger">{copy.failed}</Text>
      <Button onClick={retry}>{copy.retry}</Button>
    </div> : !items ? <Text role="status" color="secondary">{copy.loading}</Text> : <>
      <form className="queue-preset-form" onSubmit={event => void saveView(event)}>
        <div className="mcc-field">
          <label htmlFor={nameId}>{copy.name}</label>
          <TextInput id={nameId} value={name} controlProps={{maxLength: 80}} disabled={busy} onUpdate={setName}/>
        </div>
        <Button type="submit" disabled={busy || !name.trim()}>{renaming ? copy.rename : copy.save}</Button>
        {renaming && <Button onClick={() => edit(null)} disabled={busy}>{copy.cancel}</Button>}
      </form>
      {error && <Text role="alert" color="danger">{error}</Text>}
      {!items.length && <Text as="p" color="secondary">{copy.empty}</Text>}
      {items.map(preset => <div className="queue-saved-preset" key={preset.id}>
        <Link href={presetHref(preset)}>{preset.name}</Link>
        <Button size="s" view="flat-secondary" aria-label={copy.rename + ' ' + preset.name}
          disabled={busy || renaming !== null} onClick={() => edit(preset)}>{copy.rename}</Button>
        <Button size="s" view="flat-secondary" aria-label={copy.remove + ' ' + preset.name}
          disabled={busy || renaming !== null} onClick={() => void removeView(preset.id)}>{copy.remove}</Button>
      </div>)}
    </>}
  </>
}
