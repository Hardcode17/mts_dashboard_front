import type {Incident} from './demoData.ts'

type Sample =
  | {kind: 'payment'; waitMs: number; cpuPercent: number; held: number; pool: number}
  | {kind: 'auth'; failures: number; profileTimeouts: number; timeoutMs: number}

// Local stand fixtures, keyed by INC so that similar symptoms in other cards do not share evidence.
const samples: Readonly<Record<string, Sample | undefined>> = {
  INC000021940112: {kind: 'payment', waitMs: 1800, cpuPercent: 34, held: 18, pool: 24},
  INC000021940126: {kind: 'auth', failures: 50, profileTimeouts: 47, timeoutMs: 1500},
}

export const unknownTechnicalRecipient = 'Технический адресат не подтверждён'

interface Evidence {
  source: string
  finding: string
  record: string
}

export function analyzeDemoIncident(
  incident: Incident,
  sample: Sample | null | undefined = samples[incident.id],
) {
  const evidence: Evidence[] = [
    {
      source: 'ITSM',
      finding: incident.state + ' · ' + incident.team,
      record: incident.id + ' · ' + incident.title + ' · регистрация в ' + incident.registered + ' МСК',
    },
  ]
  let hypothesis: string | null = null
  let recipient = unknownTechnicalRecipient
  let question =
    'Для какой операции виден сбой? Пришлите время и идентификатор одного запроса, чтобы найти его в логах.'
  let next = 'Сопоставить запрос с трассировкой и метриками продукта за тот же интервал.'
  if (incident.restoredAt) {
    question = 'Какую проверку выполнили после восстановления в ' + incident.restoredAt + ' МСК?'
    next = 'Сопоставить замеры до и после исправления с историей карточки.'
  }

  if (sample?.kind === 'payment') {
    const {waitMs, cpuPercent, held, pool} = sample
    evidence.push(
      {
        source: 'Трассировки оплаты',
        finding: 'Ожидание соединения с БД, p95: ' + (waitMs / 1000).toLocaleString('ru') + ' с',
        record: '12:37–12:42 · checkout → payment → db.pool.acquire · p95_ms=' + waitMs,
      },
      {
        source: 'Prometheus',
        finding: 'Загрузка процессора платежей: ' + cpuPercent + '%',
        record: '12:37–12:42 · payment · cpu_percent=' + cpuPercent,
      },
      {
        source: 'PostgreSQL',
        finding: 'Фоновая сверка занимает ' + held + ' из ' + pool + ' соединений',
        record: '12:42 · pool=payment · worker=reconciliation · occupied=' + held + ' · capacity=' + pool,
      },
    )
    if (cpuPercent >= 85 && waitMs < 300) {
      hypothesis = 'Обработчики платежей насыщены. Ожидание соединения с БД невелико.'
      recipient = 'Дежурный команды платежей'
      question = 'Уменьшится ли очередь, если выделить ещё одну реплику оплаты?'
      next = 'Проверить действие на том же числе уникальных заказов и сравнить с исходным прогоном.'
    }
    if (pool > 0 && held > pool / 2 && waitMs >= 1000 && cpuPercent < 60) {
      hypothesis =
        'Оплаты могут ждать свободного соединения с БД. Фоновая сверка занимает большую часть пула, а загрузка процессора платежей умеренная.'
      recipient = 'Дежурный БД и команда платежей'
      question = 'Снизится ли ожидание соединения, если временно ограничить параллельность фоновой сверки?'
      next =
        'Повторить одинаковую нагрузку на стенде. Сравнить число оплат в срок и рост очереди фоновых задач.'
    }
  }
  if (sample?.kind === 'auth') {
    const {failures, profileTimeouts, timeoutMs} = sample
    evidence.push(
      {
        source: 'Метрики авторизации',
        finding: 'Истёк срок ожидания профиля в ' + profileTimeouts + ' из ' + failures + ' неудачных входов',
        record: '12:37–12:42 · failed_logins=' + failures + ' · profile_timeout=' + profileTimeouts,
      },
      {
        source: 'Журнал авторизации',
        finding: 'Сервис авторизации завершил ожидание ответа профиля',
        record: '12:41:36 МСК · trace=demo-auth-17 · upstream=profile · timeout_ms=' + timeoutMs,
      },
    )
    if (failures > 0 && profileTimeouts > failures / 2) {
      hypothesis =
        'Большинство ошибок связано с ожиданием ответа профиля. По журналу отправителя пока нельзя определить, на каком участке задержался запрос.'
      recipient = 'Дежурный сервиса профилей'
      question = 'Видите запрос demo-auth-17 в 12:41:36 МСК? Какой последний шаг и сколько времени он занял?'
      next =
        'Если запрос дошёл, проверить обработку профиля. Если входящей записи нет, проверить передачу запроса между сервисами.'
    }
  }
  return {evidence, hypothesis, recipient, question, next, scenario: sample?.kind}
}
