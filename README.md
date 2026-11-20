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
