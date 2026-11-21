# API-контракт для фронтенда

Канонический контракт backend ↔ frontend:

- OpenAPI: [`Hardcode17/mts_dashboard_data/docs/openapi.yaml`](https://github.com/Hardcode17/mts_dashboard_data/blob/main/docs/openapi.yaml)
- Пояснение для KAN-7: [`Hardcode17/mts_dashboard_data/docs/frontend-api-contract.md`](https://github.com/Hardcode17/mts_dashboard_data/blob/main/docs/frontend-api-contract.md)

Коротко для фронтенда:

- `GET /api/incidents` — список INC, `counts` четырёх групп, `revision`, `eventSeq`.
- `GET /api/incidents/{id}` — карточка INC, `itsmUrl`, `meetingUrl`.
- `GET /api/snapshot/status` — `lastSuccessAt`, `revision`, `stale`.
- `GET /health` — доступность сервиса.

Ключевые правила:

- `priorityId`: 4 — наивысший, 1 — низкий. Не переставлять на фронте.
- `stateEnum`: `Assigned`, `WorkInProgress`, `Resolved`, `Closed`, `Research`.
  Статуса `New` в контракте нет.
- Группы: `critical`, `coordinators`, `high`, `research`.
- Счётчики групп брать из ответа API, а не считать по `items`.
- `remainingSeconds` и `overdue` приходят с backend; не пересчитывать на клиенте.
- Пользовательская авторизация — Bearer JWT (Keycloak Authorization Code + PKCE).
- Ошибки: `{code, message}`, диагностический заголовок `X-Request-Id`.

## Интеграция в UI

- По умолчанию открывается «Большая смена». Источник **API MCC** доступен
  в разделе «Моя смена → Источник данных».
- Дашборд читает список и свежесть параллельно, затем опрашивает API каждые
  5 секунд. Если снимок `stale`, старые данные остаются видимыми с маркировкой
  устаревания; ошибки запроса не очищают последний успешный ответ.
- Список использует серверные `groups` и `counts`. Приоритет, статус и
  группы не пересчитываются по собственной альтернативной классификации.
- Номер INC открывает `/incidents/:id`; маршрут загружает карточку отдельным
  `GET /api/incidents/{id}` и показывает её в существующем Gravity UI Drawer.
- Источник API — только для чтения. Демо-действия доступны в прежних mock
  источниках, пока команды записи не появятся в контракте.
- Локальный mock server реализует те же `GET`-эндпоинты по исходному
  `mock/fixtures/incidents.json`. Это даёт KAN-7 работающий API-контур до
  готовности контроллеров backend.

События, подтверждения, история, координация и исследования — отдельные задачи.
