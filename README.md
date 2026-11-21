# MCC — фронтенд дашборда координатора

Рабочее место координатора массовых инцидентов. На одном экране видны сводка смены, очереди и сроки. В карточке можно проверить историю инцидента, зафиксировать следующий шаг и подготовить передачу дежурства.

**Локальное демо** запускается без корпоративных доступов. ITSM, уведомления, телеметрия и разбор агентом используют демонстрационные данные. **Режим с API** читает опубликованный снимок бэкенда и использует вход через Keycloak.

## Что демонстрирует

- **Сводку и очереди:** четыре группы со счётчиками, приоритеты, сроки, графики, журнал событий, поиск, фильтры, пагинацию и сохранённые представления.
- **Карточку INC:** данные ITSM и историю изменений, связанные инциденты, аварийную комнату, заметки, следующий шаг, передачу смены, сравнение мер восстановления и разбор причины агентом с ссылками на исходные наблюдения.
- **Координацию смены:** персональные назначения с таймером и переназначением, уведомления с квитанциями доставки, рекомендацию команды и сводку для принимающего дежурного.
- **Два демонстрационных набора:** «Большая смена» из 3600 карточек и 14 400 событий и «Кейс МТС» с 44 карточками из файла. Состояние, действия и отчёты сохраняются локально в SQLite.
- **Интеграционный режим:** OIDC-вход, загрузка списка и карточек из backend, проверка ревизии снимка и отображение устаревших данных. Режим API не изменяет инциденты.

Для первого прогона откройте карточку МТС Маркета `INC000021940112` в «Большой смене», затем попробуйте сравнить меры восстановления и открыть наблюдение в разборе агента. Пошаговый маршрут есть в [сценариях работы смены](docs/use-cases.md).

## Быстрый старт

Требуется Node.js 24 LTS и npm.

```sh
npm ci
npm run dev
```

Откройте [http://localhost:5173](http://localhost:5173). Backend и переменные окружения для демо не нужны: Vite поднимает локальный мок.

Полезные точки входа:

| Маршрут | Раздел |
|---|---|
| `#overview` | Сводка смены |
| `#queue/critical`, `#queue/assigned`, `#queue/high`, `#queue/research` | Очереди |
| `#desk/tasks` / `#desk/source` | Моя смена / выбор источника |
| `#events` | Общий журнал событий |
| `#incident/<ключ>` | Карточка инцидента в демо |
| `/incidents/<номер>` | Отдельная карточка из API |

На чистом профиле открывается «Большая смена». Переключение наборов — в «Моя смена» → «Источник данных». На исходном снимке «Кейса МТС» группы показывают 0, 2, 1 и 5 карточек. Для своего JSON и отдельного каталога состояния:

```sh
MCC_SOURCE_FILE=/absolute/path/to/incidents.json \
MCC_STATE_DIR=/absolute/path/to/state \
npm run dev
```

Файл проверяется каждую секунду, браузер опрашивает стенд каждые две секунды. Если файл временно сломан, остаётся последний корректный снимок. Без переменных состояние лежит в `.mcc-stand/workspace.sqlite`. Два браузера на одном стенде видят общую смену.

## Демо или backend/API

| | Локальная демонстрация | Backend/API |
|---|---|---|
| Запуск | `npm run dev` или `npm run preview` | `VITE_API_URL` либо `VITE_BACKEND_MODE=real` + `VITE_OIDC_AUTHORITY` |
| Источник данных | Встроенный мок и JSON-файл | Опубликованный снимок backend |
| Действия | Работают и сохраняются локально | Только чтение |
| Вход | Демонстрационный профиль | Keycloak, клиент `dashboard-web` |
| Состояние | SQLite на стенде | Снимок и статус backend |

### Подключение backend

1. В [репозитории бэкенда](https://github.com/Hardcode17/mts_dashboard_backend) запустите локальный стенд Keycloak, выдайте допуск координатору и загрузите тестовый снимок.
2. В realm должен быть публичный клиент `dashboard-web`. Разрешите origin фронтенда и callback `/auth/callback`.
3. Укажите адреса стенда и запустите dev-сервер:

```sh
VITE_API_URL=http://127.0.0.1:8091 \
VITE_OIDC_AUTHORITY=http://localhost:8084/realms/dashboard \
npm run dev -- --host localhost --port 3000
```

При `VITE_API_URL` Vite проксирует `/api` и `/health` на backend. Для локального адреса добавляйте в клиент Keycloak origin `http://localhost:3000` и callback `http://localhost:3000/auth/callback`.

`VITE_BACKEND_MODE=real` включает API-режим без прокси Vite: запросы идут на тот же origin. Такой режим предназначен для раздачи через `server/start.mjs` или Docker. Если authority не задан, приложение покажет экран с ошибкой конфигурации входа.

Основные маршруты контракта: `GET /api/dashboard/incidents`, `GET /api/dashboard/incidents/{id}`, `GET /api/snapshot/status`, `GET /api/me` и `GET /health`. Подробности — в [описании API-контракта](docs/api-contract.md) и [OpenAPI backend](https://github.com/Hardcode17/mts_dashboard_backend/blob/main/docs/dashboard-api.openapi.yaml).

### Переменные окружения

| Переменная | Где используется | Назначение |
|---|---|---|
| `VITE_API_URL` | dev / build | Origin API для прокси Vite; включает API-режим |
| `VITE_BACKEND_MODE=real` | dev / build | API-режим без прокси Vite |
| `VITE_OIDC_AUTHORITY` | dev / build | URL realm Keycloak, например `https://auth.example.test/realms/dashboard` |
| `VITE_ITSC_URL` | dev / build | Необязательный HTTPS-origin внешней ITSM-карточки |
| `BACKEND_URL` | `server/start.mjs` | Origin backend, обязателен для `npm start` |
| `PORT` | `server/start.mjs` | Порт статики и прокси, по умолчанию `3000` |
| `MCC_STATE_DIR` | локальный мок | Каталог SQLite |
| `MCC_SOURCE_FILE` | локальный мок | JSON для «Кейса МТС» |
| `FRONTEND_PORT` | Docker Compose | Публикуемый порт, по умолчанию `8080` |

## Проверки

```sh
npm run lint
npm run build
npm test
```

`npm test` проверяет правила очередей и групп, обработку снимков, историю, таймеры назначений, контракт API и сохранение состояния после перезапуска. Браузерные сценарии запускаются отдельно:

```sh
npx playwright install chromium   # если Chromium ещё не установлен
npm run test:browser
```

`npm run test:browser` собирает приложение и проходит сценарии в Chromium; один из сценариев переназначения ждёт реальные 60 секунд. Ожидаемые результаты сценариев собраны в [условиях приёмки](docs/acceptance.md).

Для запущенного backend-прокси доступна проверка готовности:

```sh
curl -fsS http://localhost:3000/health
```

## Docker и автономный запуск

Docker-образ собирает статику в API-режиме и запускает `server/start.mjs` от пользователя `node`. Compose публикует приложение на `FRONTEND_PORT` и передаёт backend-адрес в контейнер.

На Raspberry Pi workflow **Deploy frontend** использует `compose.pi.yaml` и
подключает frontend к сети проекта `mts-dashboard-backend`. Сначала запустите
backend, чтобы Compose создал сеть и поднял Keycloak. Funnel направляет запросы
на frontend. Frontend передаёт публичные запросы realm `dashboard` и его ресурсов
из `/auth/` в Keycloak, а `/auth/callback` обслуживает само приложение.

В Actions Variables фронтенда укажите `FRONTEND_OIDC_AUTHORITY` как
`https://<публичный-хост>/auth/realms/dashboard`. Это значение должно совпадать
с `STAND_KEYCLOAK_URL` бэкенда с добавленным суффиксом `/realms/dashboard`.
`FRONTEND_BACKEND_URL` по умолчанию использует `http://backend:8080` в сети Docker.

```sh
BACKEND_URL=https://backend.example.test \
OIDC_AUTHORITY=https://auth.example.test/realms/dashboard \
FRONTEND_PORT=8080 \
docker compose up -d --build
```

Проверка после старта:

```sh
curl -fsS http://localhost:8080/health
```

Сборка и запуск без Docker:

```sh
VITE_BACKEND_MODE=real \
VITE_OIDC_AUTHORITY=https://auth.example.test/realms/dashboard \
npm run build

BACKEND_URL=https://backend.example.test npm start
```

Автоматическая публикация настроена в [workflow деплоя](.github/workflows/deploy.yml).

## Структура и технологии

```text
src/       React-интерфейс, тема и API-клиент
mock/      локальный стенд, фикстуры и SQLite
server/    раздача dist/ и прокси API для контейнера
tests/     node:test и Playwright
docs/      сценарии, приёмка, контракт и дизайн
```

Интерфейс собран на React, TypeScript, Vite и Gravity UI. Локальный стенд использует Node.js и SQLite. Для тестов используются `node:test` и Playwright.

## Документация

- [Сценарии работы смены и маршрут демонстрации](docs/use-cases.md)
- [Условия приёмки](docs/acceptance.md)
- [Ревью интерфейса и границы проверки](docs/interface-review.md)
- [API-контракт фронтенда](docs/api-contract.md)
- [Исходный пакет дизайна Gravity UI × МТС](docs/design/mts-gravity/README.md)

## Репозитории проекта

| Репозиторий | Роль |
|---|---|
| [mts_dashboard_front](https://github.com/Hardcode17/mts_dashboard_front) | Интерфейс координатора и локальный демостенд |
| [mts_dashboard_backend](https://github.com/Hardcode17/mts_dashboard_backend) | API, доступ и приём снимков ITSM |
| [mts_dashboard_data](https://github.com/Hardcode17/mts_dashboard_data) | Материалы кейса, требования и контракты |
