# API-контракт для фронтенда

Канонический контракт backend ↔ frontend:

- OpenAPI: [`Hardcode17/mts_dashboard_data/docs/openapi.yaml`](https://github.com/Hardcode17/mts_dashboard_data/blob/main/docs/openapi.yaml)
- Пояснение для KAN-7: [`Hardcode17/mts_dashboard_data/docs/frontend-api-contract.md`](https://github.com/Hardcode17/mts_dashboard_data/blob/main/docs/frontend-api-contract.md)

Коротко для фронтенда:

- `GET /api/incidents` — список INC, `counts` четырёх групп, `revision`, `eventSeq`.
- `GET /api/incidents/{id}` — карточка INC, `itsmUrl`, `meetingUrl`.
- `GET /api/incidents/{id}/relationships` — фокус, прямой родитель и дочерние INC.
  `id` — внешний номер INC, закодированный в URL. Ответ:
  `{focusId, nodes: [{id, title, stateEnum, priorityId}], edges: [{parentId, childId}]}`.
  `title`, `stateEnum` и `priorityId` могут быть `null`; `id` — нет. Неизвестный
  INC даёт 404 в обычном формате ошибки, известный INC без связей — свой узел и
  пустой `edges`.
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
- Внизу карточки блок «Связанные инциденты» отдельно запрашивает
  `GET /api/incidents/{id}/relationships`, не блокируя основную карточку.
  Соседний узел ведёт на канонический `/incidents/:id`, поэтому граф
  перестраивается вокруг выбранного INC. Блок доступен только для просмотра:
  загрузка, пустое состояние и локальная ошибка с повтором.
- Источник API — только для чтения. Демо-действия доступны в прежних mock
  источниках, пока команды записи не появятся в контракте.
- Локальный mock server реализует те же `GET`-эндпоинты по исходному
  `mock/fixtures/incidents.json`. Это даёт KAN-7 работающий API-контур до
  готовности контроллеров backend.

События, подтверждения, история, координация и исследования — отдельные задачи.

### Монитор и связи через Spring

Сервер фронтенда принимает `MCC_BACKEND_ORIGIN` с адресом Spring, доступным из контейнера фронтенда. С этой настройкой запросы сводки мониторинга, карточки и связей идут к Spring через тот же origin, что и страница. Сервер передаёт заголовок `Authorization` пользователя. Карточка адаптируется к модели фронтенда, переходы по графу открывают данные одного источника. Остальные маршруты идут по существующей схеме.

Для входа через Keycloak передайте при сборке `VITE_KEYCLOAK_URL`, `VITE_KEYCLOAK_REALM` и `VITE_KEYCLOAK_CLIENT_ID`. Для штатного realm используются `dashboard` и `dashboard-web`. Зарегистрируйте фактический URL фронтенда в Valid Redirect URIs и Web Origins публичного клиента. Фронтенд выполняет вход через Authorization Code с PKCE и обновляет токен перед запросами. В переменных сборки хранятся только публичные параметры клиента.

Адрес монитора — `/?mode=monitor`. Без `MCC_BACKEND_ORIGIN` локальный сервер показывает текущие демоданные и пустую историю. Часовой пояс экрана одинаков для истории и отметок проверки.
