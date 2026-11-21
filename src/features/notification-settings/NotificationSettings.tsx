import {useEffect, useId, useState, type FormEvent} from 'react'
import {Button, Card, Checkbox, Flex, getConfig, Label, Select, Switch, Text, TextInput} from '@gravity-ui/uikit'
import {workspaceFetch} from '../../auth/session'
import type {PriorityId} from '../../entities/incident/model/api-types'
import {
  createNotificationSettingsApi, isInvalidNotificationSettings, notificationChannels,
  type NotificationChannel, type NotificationConnection, type NotificationConnectionSettings,
} from './api'
import {notificationSettingsMessages} from './messages'

const api = createNotificationSettingsApi(workspaceFetch)
const priorities: PriorityId[] = [1, 2, 3, 4]
const addressPattern = /^[a-zA-Z0-9@+_.-]{1,254}$/
const emptySettings: NotificationConnectionSettings = {channel: 'email', address: '', active: true, priorityIds: []}

type Copy = (typeof notificationSettingsMessages)[keyof typeof notificationSettingsMessages]

function ConnectionEditor({connection, copy, onCancel, onSaved}: {
  connection?: NotificationConnection
  copy: Copy
  onCancel: () => void
  onSaved: (connection: NotificationConnection) => void
}) {
  const [settings, setSettings] = useState<NotificationConnectionSettings>(connection ?? emptySettings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const channelId = useId()
  const addressId = useId()

  function change(update: Partial<NotificationConnectionSettings>) {
    setSettings(previous => ({...previous, ...update}))
    setError('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const address = settings.address.trim()
    if (!addressPattern.test(address)) {
      setError(copy.invalidAddress)
      return
    }
    setSaving(true)
    setError('')
    try {
      onSaved(await api.save({...settings, address}, connection?.id))
    } catch (cause) {
      setError(isInvalidNotificationSettings(cause) ? copy.invalid : copy.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="desk-stack" onSubmit={event => void save(event)}>
      <Text as="h3" variant="subheader-2">{connection ? copy.editTitle : copy.addTitle}</Text>
      <div className="mcc-field">
        <label htmlFor={channelId}>{copy.channel}</label>
        <Select id={channelId} width="max" disabled={saving} value={[settings.channel]}
          options={notificationChannels.map(value => ({value, content: copy.channels[value]}))}
          onUpdate={([channel]) => change({channel: channel as NotificationChannel})}/>
      </div>
      <div className="mcc-field">
        <label htmlFor={addressId}>{copy.address}</label>
        <TextInput id={addressId} value={settings.address} disabled={saving}
          onUpdate={address => change({address})}/>
      </div>
      <fieldset className="shift-message-channels">
        <legend>{copy.priorities}</legend>
        <Flex gap="spacing-3" wrap>
          {priorities.map(priority => (
            <Checkbox key={priority} checked={settings.priorityIds.includes(priority)} disabled={saving}
              onUpdate={checked => change({priorityIds: checked
                ? [...settings.priorityIds, priority] : settings.priorityIds.filter(value => value !== priority)})}>
              P{priority}
            </Checkbox>
          ))}
        </Flex>
      </fieldset>
      <Switch checked={settings.active} disabled={saving} onUpdate={active => change({active})}>
        {copy.enabled}
      </Switch>
      {error && <Text role="alert" color="danger">{error}</Text>}
      <Flex gap="spacing-2" wrap>
        <Button type="submit" view="action" loading={saving} disabled={saving}>{copy.save}</Button>
        <Button onClick={onCancel} disabled={saving}>{copy.cancel}</Button>
      </Flex>
    </form>
  )
}

export function NotificationSettings() {
  const copy = notificationSettingsMessages[getConfig().lang === 'ru' ? 'ru' : 'en']
  const [connections, setConnections] = useState<NotificationConnection[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [editor, setEditor] = useState<'new' | NotificationConnection | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void api.list(AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])).then(
      result => {if (!controller.signal.aborted) setConnections(result)},
      () => {if (!controller.signal.aborted) setLoadFailed(true)},
    )
    return () => controller.abort()
  }, [attempt])

  function open(next: NonNullable<typeof editor>) {
    setSaved(false)
    setEditor(next)
  }

  function confirm(connection: NotificationConnection) {
    setConnections(previous => previous?.some(item => item.id === connection.id)
      ? previous.map(item => item.id === connection.id ? connection : item)
      : [...(previous ?? []), connection])
    setEditor(null)
    setSaved(true)
  }

  return (
    <Card className="mcc-glass incident-panel">
      <Flex alignItems="center" justifyContent="space-between" gap="spacing-3" wrap>
        <Text as="h2" variant="header-1">{copy.title}</Text>
        {connections && <Button onClick={() => open('new')} disabled={editor !== null}>{copy.add}</Button>}
      </Flex>
      {loadFailed ? <Flex gap="spacing-2" wrap>
        <Text role="alert" color="danger">{copy.loadFailed}</Text>
        <Button onClick={() => {setLoadFailed(false); setAttempt(value => value + 1)}}>{copy.retry}</Button>
      </Flex> : !connections && <Text role="status" color="secondary">{copy.loading}</Text>}
      {saved && <Text role="status" color="positive">{copy.saved}</Text>}
      {connections?.length === 0 && !editor && <Text color="secondary">{copy.empty}</Text>}
      {editor && <ConnectionEditor connection={editor === 'new' ? undefined : editor} copy={copy}
        onCancel={() => setEditor(null)} onSaved={confirm}/>}
      {!!connections?.length && <ul className="desk-list">
        {connections.map(connection => (
          <li key={connection.id}>
            <Flex alignItems="center" gap="spacing-2" wrap>
              <Text variant="subheader-2">{copy.channels[connection.channel]}</Text>
              <Label theme={connection.active ? 'success' : 'normal'}>
                {connection.active ? copy.active : copy.inactive}
              </Label>
              <Text>{connection.address}</Text>
              <Text color="secondary">
                {connection.priorityIds.length ? connection.priorityIds.map(priority => 'P' + priority).join(', ') : copy.noPriorities}
              </Text>
              <Button onClick={() => open(connection)} disabled={editor !== null}>{copy.edit}</Button>
            </Flex>
          </li>
        ))}
      </ul>}
    </Card>
  )
}
