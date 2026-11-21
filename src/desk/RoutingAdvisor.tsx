import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react'
import {Button, Card, Flex, Label, Link, Loader, Select, Text, TextArea, TextInput} from '@gravity-ui/uikit'
import type {Incident} from '../demoData'
import {useWorkspace} from './context'
import {usesRealBackend} from '../shared/api/mode'
import {approvedTeam, technicalTeam} from './types'
import {
  fetchRoutingCatalogue,
  incidentSymptom,
  routingAdvisorEnabled,
  routingQuerySymptom,
  searchRouting,
  type RoutingCatalogue,
  type RoutingSearchResult,
} from './routingAdvisorApi'

const percent = new Intl.NumberFormat('ru-RU', {style: 'percent', maximumFractionDigits: 1})

export function RoutingAdvisor({item, past}: {item: Incident; past?: Incident}) {
  const {desk, act, person, busy, itsmExternal} = useWorkspace(),
    work = desk.work[item.key],
    availability = work?.availability ?? 'unknown'
  const name = !usesRealBackend && item.site === 'Ростов'
    ? 'Сетевая поддержка · Ростов'
    : technicalTeam(past?.team) || technicalTeam(item.team)
  const saved = approvedTeam(work, name)
  const [draft, setTeam] = useState<string | undefined>(),
    [reason, setReason] = useState('')
  const team = draft ?? (saved || name)
  const targetTeam = technicalTeam(team)
  const myAttempt = desk.tasks.find(t => t.key === item.key && !t.finished)?.attempts.at(-1)
  const canHandOff = myAttempt?.person === person && myAttempt.accepted && !myAttempt.ended
  const [sent, setSent] = useState(false)
  const measured = Boolean(past?.specialists && past.workMinutes)
  const wait = availability === 'ready' ? 0 : availability === 'wait' ? 60 : null
  return (
    <>
    <Card className="mcc-glass incident-panel">
      <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap>
        <Text as="h2" variant="header-1">
          Кому передать проверку
        </Text>
        <Label theme="utility">Рекомендация</Label>
      </Flex>
      {past ? (
        <>
          <Link href={'#incident/' + past.key}>
            {past.id} · {past.product} · {past.site ?? 'прошлый случай'}
          </Link>
          <Text>Результат: {past.solution || 'текст решения отсутствует'}.</Text>
        </>
      ) : (
        <Text>Нет сопоставимого завершённого случая. Уточните владельца и доступность команды.</Text>
      )}
      <Text>
        Предлагаемая группа — {name || 'требуется уточнить владельца'}.{' '}
        {measured
          ? 'Опыт прошлого случая: ' +
            past!.specialists +
            ' специалиста, ' +
            past!.workMinutes +
            ' мин работы.'
          : 'Размер команды и длительность работ в истории не указаны.'}
      </Text>
      {measured && (
        <>
          <Text>
            {wait === null
              ? 'Ожидание неизвестно. Спросить старшего смены, когда будет полный состав.'
              : 'При старте полным составом: ' +
                wait +
                ' мин ожидания + ' +
                past!.workMinutes +
                ' мин работ = ' +
                (wait + past!.workMinutes!) +
                ' мин до восстановления.'}
          </Text>
        </>
      )}
      <div className="incident-fields">
        <div className="mcc-field">
          <label htmlFor="advisor-team">Предлагаемая команда</label>
          <TextInput id="advisor-team" value={team} onUpdate={value => {setSent(false); setTeam(value)}} />
        </div>
        <div className="mcc-field">
          <label htmlFor="advisor-comment">Комментарий координатора</label>
          <TextInput id="advisor-comment" value={reason} onUpdate={setReason} />
        </div>
      </div>
      <Flex gap="spacing-2" wrap>
        <Button
          disabled={!targetTeam || busy}
          onClick={() =>
            void act({
              type: 'advisor',
              key: item.key, person, kind: 'accept', value: targetTeam,
              text: (team === name ? 'Принято: ' : 'Уточнено: ') + team + (reason ? ' · ' + reason : ''),
            })
          }
        >
          Согласовать рекомендацию
        </Button>
        <Button
          onClick={() =>
            void act({type: 'advisor', key: item.key, person, kind: 'reject', text: 'Отклонено' + (reason ? ': ' + reason : '')})
          }
        >
          Отклонить
        </Button>
      </Flex>
      {work?.recommendation && <Text role="status">{work.recommendation}</Text>}
      {targetTeam && !sent && (canHandOff ? (
        <Button view="action" disabled={busy} onClick={async () => {
          const ok = await act({type:'handoff', key:item.key, person, id:myAttempt.id, value:targetTeam, expected:item.updatedAt ?? 0})
          if (ok) setSent(true)
        }}>Передать исполнителю</Button>
      ) : <Link href={'#itsm/' + encodeURIComponent(item.key) + '?team=' + encodeURIComponent(targetTeam)}>Изменить назначение в ITSM</Link>)}
      {sent && <Text role="status">{itsmExternal ? 'ITSM подтвердила назначение' : 'Назначение на стенде'} · {desk.records[item.key]?.team ?? item.team}</Text>}
    </Card>
      {routingAdvisorEnabled && <LocalRoutingSearch key={item.key} item={item} />}
    </>
  )
}

function LocalRoutingSearch({item}: {item: Incident}) {
  const symptomId = 'routing-symptom-' + item.key
  const serviceId = 'routing-service-' + item.key
  const siteId = 'routing-site-' + item.key
  const infrastructureId = 'routing-infrastructure-' + item.key
  const [symptom, setSymptom] = useState(() => incidentSymptom(item))
  const [service, setService] = useState('')
  const [site, setSite] = useState('')
  const [infrastructure, setInfrastructure] = useState('')
  const [catalogue, setCatalogue] = useState<RoutingCatalogue | null>(null)
  const [catalogueError, setCatalogueError] = useState('')
  const [catalogueLoading, setCatalogueLoading] = useState(true)
  const [result, setResult] = useState<RoutingSearchResult | null>(null)
  const [searchError, setSearchError] = useState('')
  const [loading, setLoading] = useState(false)
  const catalogueRequest = useRef(0)
  const searchRequest = useRef(0)
  const catalogueAbort = useRef<AbortController | null>(null)
  const searchAbort = useRef<AbortController | null>(null)

  const startCatalogueRequest = useCallback(() => {
    catalogueAbort.current?.abort()
    const controller = new AbortController()
    catalogueAbort.current = controller
    const request = ++catalogueRequest.current
    return fetchRoutingCatalogue(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted && request === catalogueRequest.current) setCatalogue(next)
      })
      .catch((error) => {
        if (!controller.signal.aborted && request === catalogueRequest.current) {
          setCatalogueError(error instanceof Error ? error.message : 'Не удалось загрузить справочник.')
        }
      })
      .finally(() => {
        if (request === catalogueRequest.current && !controller.signal.aborted) setCatalogueLoading(false)
      })
  }, [])

  useEffect(() => {
    void startCatalogueRequest()
    return () => {
      catalogueAbort.current?.abort()
      searchAbort.current?.abort()
      catalogueRequest.current += 1
      searchRequest.current += 1
    }
  }, [startCatalogueRequest])

  function clearResult() {
    setResult(null)
    setSearchError('')
  }

  async function findSimilar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = symptom.trim()
    if (!text || (!service && !infrastructure) || !catalogue || loading) return
    searchAbort.current?.abort()
    const controller = new AbortController()
    searchAbort.current = controller
    const request = ++searchRequest.current
    setResult(null)
    setSearchError('')
    setLoading(true)
    try {
      const next = await searchRouting(
        {
          incident_id: item.id,
          symptom: routingQuerySymptom(item, text),
          service: service || undefined,
          site: site || undefined,
          infrastructure: infrastructure ? [infrastructure] : [],
          current_group: item.team.trim() || undefined,
        },
        controller.signal,
      )
      if (controller.signal.aborted || request !== searchRequest.current) return
      if (next.incident_id !== item.id) {
        setSearchError('Ответ относится к другой карточке. Повторите поиск.')
        return
      }
      setResult(next)
    } catch (error) {
      if (controller.signal.aborted || request !== searchRequest.current) return
      setSearchError(error instanceof Error ? error.message : 'Локальный поиск не ответил.')
    } finally {
      if (request === searchRequest.current) setLoading(false)
    }
  }

  const disabled = !catalogue || !symptom.trim() || (!service && !infrastructure) || loading

  return (
    <Card className="mcc-glass incident-panel">
      <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap>
        <Text as="h2" variant="header-1">
          Поиск по локальной истории
        </Text>
        <Label theme="info">Локальный стенд · PostgreSQL + pgvector</Label>
      </Flex>
      <Text color="secondary">
        Поиск по завершённым инцидентам с известным исходом. Выберите сервис или инфраструктуру.
      </Text>
      <Text>
        Карточка {item.id}. Текущая группа: {item.team || 'не указана'}.
      </Text>

      {catalogueLoading && (
        <Flex alignItems="center" gap="spacing-2" role="status">
          <Loader size="s" />
          <Text>Загружаем справочник сервисов, площадок и инфраструктуры…</Text>
        </Flex>
      )}
      {catalogueError && (
        <>
          <Text role="alert" color="danger">
            Локальный поиск недоступен: {catalogueError}
          </Text>
          <Button
            size="s"
            view="outlined"
            onClick={() => {
              setCatalogue(null)
              setCatalogueError('')
              setCatalogueLoading(true)
              void startCatalogueRequest()
            }}
          >
            Повторить загрузку
          </Button>
        </>
      )}

      {catalogue && (
        <form className="desk-stack" onSubmit={findSimilar} aria-busy={loading}>
          <div className="mcc-field">
            <label htmlFor={symptomId}>Симптом</label>
            <TextArea
              id={symptomId}
              rows={3}
              value={symptom}
              placeholder="Например: не пускает в Wi-Fi в Ростове"
              controlProps={{maxLength: 1000}}
              onUpdate={(value) => {
                setSymptom(value)
                clearResult()
              }}
            />
            <Text color="secondary" variant="caption-2">
              Исходный текст карточки подставлен автоматически и добавляется к уточнению, чтобы не потерять
              контекст.
            </Text>
          </div>
          <div className="incident-fields">
            <div className="mcc-field">
              <label htmlFor={serviceId}>Сервис</label>
              <Select
                id={serviceId}
                width="max"
                placeholder="Не выбран"
                hasClear
                filterable
                value={service ? [service] : []}
                options={catalogue.service.map((value) => ({value, content: value}))}
                onUpdate={([value]) => {
                  setService(value ?? '')
                  clearResult()
                }}
              />
            </div>
            <div className="mcc-field">
              <label htmlFor={infrastructureId}>Инфраструктура</label>
              <Select
                id={infrastructureId}
                width="max"
                placeholder="Не указана"
                hasClear
                filterable
                value={infrastructure ? [infrastructure] : []}
                options={catalogue.infrastructure.map((value) => ({value, content: value}))}
                onUpdate={([value]) => {
                  setInfrastructure(value ?? '')
                  clearResult()
                }}
              />
            </div>
            <div className="mcc-field">
              <label htmlFor={siteId}>Площадка</label>
              <Select
                id={siteId}
                width="max"
                placeholder="Не указана"
                hasClear
                filterable
                value={site ? [site] : []}
                options={catalogue.site.map((value) => ({value, content: value}))}
                onUpdate={([value]) => {
                  setSite(value ?? '')
                  clearResult()
                }}
              />
            </div>
          </div>
          <Text color="secondary" variant="caption-2">
            Значения сервиса и площадки берутся из справочника.
          </Text>
          <Flex alignItems="center" gap="spacing-3" wrap>
            <Button type="submit" view="action" loading={loading} disabled={disabled}>
              Найти похожие
            </Button>
            {!service && !infrastructure && (
              <Text color="secondary">Выберите сервис или инфраструктуру, чтобы задать область поиска.</Text>
            )}
          </Flex>
        </form>
      )}

      {searchError && (
        <Text role="alert" color="danger">
          {searchError}
        </Text>
      )}
      {result && <LocalSearchResult result={result} />}
    </Card>
  )
}

function LocalSearchResult({result}: {result: RoutingSearchResult}) {
  const recommendation = result.recommendation
  return (
    <div className="desk-stack" role="region" aria-label="Результат локального поиска" aria-live="polite">
      <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap>
        <Text as="h3" variant="header-1">
          Похожие завершённые инциденты
        </Text>
        <Label theme={result.analogues.length ? 'success' : 'unknown'}>{result.analogues.length}</Label>
      </Flex>
      {result.candidate_count !== undefined && (
        <Text color="secondary" variant="caption-2">
          Кандидатов после фильтра: {result.candidate_count}
        </Text>
      )}
      {result.analogues.length ? (
        <ul className="desk-list">
          {result.analogues.map((analogue) => (
            <li key={analogue.incident_id}>
              <Flex alignItems="center" gap="spacing-2" wrap>
                <Text variant="subheader-1">{analogue.incident_id}</Text>
                <Label theme="normal">Сходство {percent.format(analogue.similarity)}</Label>
                <Label theme={analogue.outcome ? 'success' : 'unknown'}>
                  {analogue.outcome ? 'Исход известен' : 'Исход не указан'}
                </Label>
              </Flex>
              <Text>Исход: {analogue.outcome || 'не указан'}</Text>
              <Text>Решившая группа: {analogue.resolved_by || 'не указана'}</Text>
              {analogue.matched_signals.length > 0 && (
                <Text color="secondary">Совпало: {analogue.matched_signals.join(' · ')}</Text>
              )}
              {analogue.differences.length > 0 && (
                <Text color="secondary">Отличия: {analogue.differences.join(' · ')}</Text>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Text>По выбранным параметрам не нашлось завершённых аналогов с известным исходом.</Text>
      )}
      <div>
        <Text as="h3" variant="subheader-2">
          Предлагаемая группа
        </Text>
        {recommendation ? (
          <Flex direction="column" gap="spacing-1">
            <Text variant="subheader-1">{recommendation.group}</Text>
            <Text color="secondary">{recommendation.reasons.join(' ')}</Text>
            {recommendation.incident_ids.length > 0 && (
              <Text color="secondary" variant="caption-2">
                На основании: {recommendation.incident_ids.join(', ')}
              </Text>
            )}
          </Flex>
        ) : (
          <Text>
            {result.analogues.length === 0
              ? 'Группа не предложена: полезных аналогов недостаточно.'
              : 'Группа не предложена. Проверьте в справочнике владельца сервиса и текущее назначение.'}
          </Text>
        )}
      </div>
      <Text color="secondary" variant="caption-2">
        Источник — локальная история PostgreSQL с индексом pgvector.
      </Text>
    </div>
  )
}
