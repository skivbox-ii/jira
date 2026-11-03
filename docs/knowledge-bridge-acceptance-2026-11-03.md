# Сервер подключения Confluence: проверка 03.11.2026

Реализация опубликована: `cc8eeb840b777b0f97af52fff3cdf90d6052e318`.
Файл: `scripts/start-knowledge-bridge.ps1`.
SHA-256: `3f62f4d33297bcb3b98354ef80a569ac73f897e2780ac8bae3499c6ce83865e9`.
Файл с raw.githubusercontent.com по закреплённому коммиту побайтово совпал.

## Локально

- Автор Sol 6.1 и отдельный Reviewer Sol 6.1; открытых замечаний нет.
- PowerShell 7.6.9: `tests/knowledge-bridge.tests.ps1` — 79 проверок прошли. Автор дополнительно выполнил 10 HTTP-проверок.
- Личная проверка реально работающего HttpListener: health 200; без ключа 403; POST 405; чужой Origin 403; чужой Host отклонён самим listener (404); неизвестный proxy-route 404. Ответы приложения no-store; wildcard CORS отсутствует.
- Лично открыт итоговый UI, кнопка «Проверить сервер» вернула 200 и `local-confluence-read-only`. Форма поиска и поле чтения по ID видны. Локальный upstream — example.org, не production; реальные внутренние данные с хоста не запрашивались.
- Первый общий Node-прогон не прошёл из-за отсутствующего NODE_PATH/jsdom в четырёх существующих наборах. Повтор с документированным NODE_PATH: 2123 passed / 3 failed из 2126. Все три отказа — ECONNREFUSED 127.0.0.1:4317 в существующих `tests/browser/import-preview-component-sync.test.cjs`, `import-preview-due-date-sync.test.cjs`, `import-preview-startup.test.cjs`: требуемый ими preview-сервер не запущен. Их код не менялся. Полный набор не объявляется зелёным. Лог `/tmp/knowledge-bridge-full-tests.log`.

## Citrix

Открыта отдельная вкладка PowerShell 2, чтобы не остановить существующий ClickHouse-сервер. Лично подтверждена Windows PowerShell `5.1.19041.6456`.

Загрузка GitHub сначала получила Cache Access Denied от корпоративного прокси. Штатная авторизация через `-ProxyUseDefaultCredentials` и адрес из `[Net.WebRequest]::DefaultWebProxy.GetProxy(...)` позволила скачать закреплённый скрипт в `$env:TEMP\kb.ps1`. Лично прочитан SHA-256 в PowerShell — совпал с указанным выше.

Попытка запуска `& "$env:TEMP\kb.ps1" -ConfluenceBaseUrl <реальный HTTPS origin>` отклонена корпоративной политикой ограничения программ: `PSSecurityException`, `UnauthorizedAccess`, сообщение о software restriction / Group Policy. **Listener в Citrix не запущен; production-доступ Confluence не проверен.** Не применялись обходы через iex, смену ExecutionPolicy, перенос в другой каталог или изменение политик. Требуется согласованный с поддержкой VDI способ запуска. Пользователю сообщено.

Доказательства локально: `~/.codex/citrix-prod-runs/pmi-prod-20261103-163000/screenshots/inspect-20261103-163001-17317.png` (совпавший хеш), `~/.codex/citrix-prod-runs/pmi-prod-20261103-163102/screenshots/inspect-20261103-163102-28145.png` (отказ политики).

Браузерная сессия Confluence не переносится в PowerShell автоматически. Токены не создавались; успешное чтение защищённых страниц не заявляется.

Это сервер подключения с диагностикой. Полный чат Pico, Jira-инструменты и LLM в этот выпуск не входят.
