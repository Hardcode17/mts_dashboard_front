# MTS Dashboard Frontend

React + TypeScript + Vite с [Gravity UI](https://gravity-ui.com/libraries/uikit).
Подключены стили, шрифты и `ThemeProvider`, на стартовой странице — компоненты `Text` и `Button`.

## Дизайн-система

- `src/theme/` — рабочая тема приложения: `mts-theme.css`, `fonts.css`,
  `mts-navigation.css` и шрифты `fonts/`. Подключается в `src/main.tsx` после
  стилей UIKit.
- `docs/design/mts-gravity/` — исходный пакет дизайна: `styles.json` и
  `styles-v2.json` для Themer, обе версии CSS-темы, шрифты, автономный
  предпросмотр `preview/index.html` и скриншоты. В сборку не попадает.

Проект использует `@gravity-ui/uikit` 8, поэтому в `src/theme/` взята
`mts-theme-v2.css` (структура токенов UIKit 7+). Вариант `mts-theme.css` для
UIKit 6 хранится в `docs/design/mts-gravity/` как справочный. Не подключайте обе
темы одновременно.

## Локальная разработка

Требуется Node.js 24 LTS и npm.

```sh
npm ci
npm run dev
```

Приложение: http://localhost:5173.

```sh
npm run lint
npm run build
npm run preview
```

Исходники находятся в `src/`, статические файлы — в `public/`, результат сборки — в `dist/`.

## Деплой через Docker

Требуется запущенный Docker Engine с поддержкой Linux-контейнеров и Docker Compose.
Из папки проекта:

```sh
docker compose up -d --build
```

Приложение: http://localhost:8080. Порт можно изменить переменной `FRONTEND_PORT`
в окружении или в локальном файле `.env`, например `FRONTEND_PORT=3000`.

Образ собирается в два этапа: Node.js собирает приложение, затем пакет `serve`
обслуживает готовую статику на порту 3000. Настроены SPA fallback и healthcheck `/`.
Контейнер работает от непривилегированного пользователя `node`.
Для запуска сборки без Docker: `npm run build`, затем `npm start` (http://localhost:3000).

```sh
docker compose logs -f frontend
docker compose down
```

После изменения исходников снова выполните `docker compose up -d --build`.

## Автодеплой GitHub Actions

Workflow `.github/workflows/deploy.yml` запускается после push в `main`
или вручную через Actions → Deploy frontend → Run workflow (ветка `main`).
Используется runner организации Hardcode17 с метками `self-hosted`, `Linux`,
`ARM64`, `pi-web` (настроенный `raspberrypi-front`).

На runner должны быть запущены Docker Engine и установлен Docker Compose v2
с поддержкой `up --wait`. Пользователь службы runner должен иметь доступ к Docker
без `sudo`. В настройках группы runner разрешите доступ репозиторию
`Hardcode17/mts_dashboard_front`.

Workflow собирает образ непосредственно на ARM64 runner, проверяет линтер и
TypeScript, заменяет контейнер и ждёт успешного healthcheck. До успешной сборки
работающий контейнер не останавливается. Одновременные деплои выполняются по очереди.

Адрес после деплоя: `http://<IP Raspberry Pi>:8080`.
Для другого порта задайте переменную репозитория `FRONTEND_PORT` в
Settings → Secrets and variables → Actions → Variables. Порт должен быть доступен
в сетевых настройках сервера. SSH и registry secrets для этого способа не нужны.

Для ручного управления контейнером на runner используйте тот же Compose project:

```sh
docker compose -p mts-dashboard-front ps
docker compose -p mts-dashboard-front logs -f frontend
```
asd