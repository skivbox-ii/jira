# Standalone Server для UJG виджетов

## Контекст

Три Jira-виджета (Sprint Health, Project Analytics, Timesheet) работают как AMD-модули внутри Jira Dashboard. Нужен standalone-сервер, который отображает те же виджеты вне Jira, используя **тот же код без изменений**.

## Решение

Node.js + Express сервер, который:
1. Предоставляет страницу логина (Jira URL + логин + пароль)
2. Проксирует `/rest/*` запросы в Jira с Basic Auth из сессии
3. Отдаёт HTML-страницы с виджетами по отдельным URL

Виджеты работают без изменений: `_ujgCommon.js` при отсутствии `AJS` устанавливает `baseUrl = ""`, поэтому все `$.ajax` запросы идут относительно текущего хоста — прямо на наш прокси.

## Архитектура

```
Browser                    Express Server                  Jira Server/DC
  │                              │                               │
  │  POST /login                 │                               │
  │  {jiraUrl, user, pass}       │                               │
  │─────────────────────────────>│  GET {jiraUrl}/rest/api/2/myself
  │                              │──────────────────────────────>│
  │                              │  <── 200 OK                   │
  │  <── session + redirect /    │                               │
  │                              │                               │
  │  GET /sprint                 │                               │
  │─────────────────────────────>│                               │
  │  <── sprint.html             │                               │
  │                              │                               │
  │  POST /rest/api/2/search     │  POST /rest/api/2/search      │
  │  (jQuery ajax from widget)   │  + Authorization: Basic ...   │
  │─────────────────────────────>│──────────────────────────────>│
  │  <── JSON                    │  <── JSON                     │
```

## Аутентификация

- Страница `/login`: поля Jira URL, логин, пароль
- Сервер проверяет креды через `GET {jiraUrl}/rest/api/2/myself`
- При успехе: `express-session` сохраняет `jiraUrl`, `username`, `password` в памяти
- Middleware на все роуты кроме `/login` — редирект на `/login` без сессии
- Кнопка "Выйти" очищает сессию

## Прокси

- Перехватывает `/rest/*`
- Берёт из сессии `jiraUrl` и credentials
- Формирует `{jiraUrl}/rest/...`, пробрасывает метод, Content-Type, тело
- Добавляет `Authorization: Basic {base64(user:pass)}`
- Возвращает ответ Jira как есть
- Реализация: ручной fetch (встроенный `node:https` или `node-fetch`)

## Страницы виджетов

| URL | Виджет | JS файл | CSS файл |
|-----|--------|---------|----------|
| `/sprint` | Sprint Health | `ujg-sprint-health.js` | `ujg-sprint-health.css` |
| `/analytics` | Project Analytics | `ujg-project-analytics.js` | `ujg-project-analytics.css` |
| `/timesheet` | Timesheet | `ujg-timesheet.js` | `ujg-timesheet.css` |

Каждая страница:
1. Подключает jQuery и RequireJS
2. Подключает `_ujgCommon.js` и виджет JS/CSS
3. Создаёт контейнер и инициализирует виджет с адаптером API:

```javascript
var API = {
    getGadgetContentEl: function() { return $("#widget-container"); },
    resize: function() { /* no-op в standalone */ }
};
require(["_ujgSprintHealth"], function(Gadget) {
    new Gadget(API);
});
```

Навигация: шапка со ссылками Sprint Health | Project Analytics | Timesheet | Выйти.

## Структура файлов

```
jira/
├── standalone/
│   ├── package.json
│   ├── server.js
│   ├── public/
│   │   ├── login.html
│   │   ├── sprint.html
│   │   ├── analytics.html
│   │   ├── timesheet.html
│   │   └── style.css
│   └── README.md
├── _ujgCommon.js          # без изменений
├── ujg-sprint-health.js   # без изменений
├── ujg-project-analytics.js
├── ujg-timesheet.js
└── ...css
```

JS/CSS виджетов не копируются — Express отдаёт их из `jira/` через `express.static`.

## Запуск

```bash
cd jira/standalone
npm install
node server.js
# → http://localhost:3000
```

## Зависимости

- `express` — HTTP-сервер, роутинг, статика
- `express-session` — сессии в памяти

## Целевое окружение

- Jira Server / Data Center (on-premise)
- Basic Auth (username + password)
- Корпоративная сеть, HTTPS на уровне инфраструктуры
