## Как импортировать модули в Excel (VBA)

1. Открой Excel → `Alt + F11` (редактор VBA).
2. В меню `File` → `Import File...`
3. Импортируй оба файла:
   - `vba\JsonConverter.bas`
   - `vba\JiraExcel.bas`
4. В VBA: `Tools` → `References...` и убедись, что включено:
   - **Microsoft XML, v6.0** (MSXML2)
5. Запуск: `Alt + F8` → `RunJiraUpdate`

### Важно
- Для Jira чаще всего нужен **API Token**, а не пароль.
- Логин обычно email/username, токен — строка из профиля Jira.
