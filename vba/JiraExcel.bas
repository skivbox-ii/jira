Attribute VB_Name = "JiraExcel"
Option Explicit

' ====== НАСТРОЙКИ (под себя) ======
' Можно оставить пустым и задавать через env/файл/ввод при запуске.
Private Const BASE_URL As String = ""

' Версия скрипта для отладки
Private Const SCRIPT_VERSION As String = "2026-01-16.6"
' Включить доп.лог в таблицу
Private Const DEBUG_LOG As Boolean = True

' В Jira поле "Sprint" почти всегда customfield_XXXXX.
' В JS-виджете `ujg-sprint-health.js` поле Sprint резолвится автоматически через /rest/api/2/field,
' а если не найдено — используется fallback customfield_10020. Здесь делаем то же.
Private Const SPRINT_FIELD_ID As String = "customfield_10020"

' Где в Excel искать ключи задач (как в твоём коде со скриншота):
Private Const KEY_COL As Long = 12          ' колонка с ключом (L)
Private Const HEADER_ROW As Long = 9        ' строка заголовков
Private Const FIRST_DATA_ROW As Long = 10   ' первая строка данных

' Источник логина/пароля: сначала переменные окружения, потом файл в %APPDATA%
Private Const CRED_ENV_LOGIN As String = "JIRA_LOGIN"
Private Const CRED_ENV_TOKEN As String = "JIRA_TOKEN"
Private Const CRED_ENV_PASSWORD As String = "JIRA_PASSWORD"
Private Const CRED_ENV_PASS As String = "JIRA_PASS"
Private Const CRED_ENV_BASE_URL As String = "JIRA_BASE_URL"
Private Const CRED_ENV_HOST As String = "JIRA_HOST"
Private Const CRED_ENV_SITE As String = "JIRA_SITE"
Private Const CRED_FILE_REL As String = "\JiraExcel\credentials.txt"

Private gBaseUrl As String
Private gBaseUrlSource As String
Private gCredsSource As String
Private gLastRequestUrl As String
Private gLastRequestName As String
Private gLastRequestStatus As Long
Private gLastResponseSnippet As String
Private gLastResponseFull As String

' Заголовки создаваемых/ищущихся колонок:
Private Const H_STATUS As String = "Jira: Статус"
Private Const H_ASSIGNEE As String = "Jira: Исполнитель"
Private Const H_UPDATED As String = "Jira: Последнее обновление"
Private Const H_SPRINT As String = "Jira: Спринт"
Private Const H_COMMENTS As String = "Jira: Комментарии (время | автор | текст)"
Private Const H_SUBTASKS As String = "Jira: Детки (key / summary / status)"
Private Const H_ERROR As String = "Jira: Ошибка"
Private Const H_DEBUG As String = "Jira: Debug (запрос)"
Private Const H_RESPONSE As String = "Jira: Response (ответ)"

' ====== ПУБЛИЧНЫЕ ТОЧКИ ВХОДА ======

Public Sub RunJiraUpdate()
    Dim baseUrl As String
    Dim baseUrlSource As String
    baseUrl = ResolveBaseUrl(baseUrlSource)
    If Len(baseUrl) = 0 Then
        baseUrl = InputBox("Jira base URL (например https://jira.company.com):", "Jira")
        baseUrl = NormalizeBaseUrl(baseUrl)
        If Len(baseUrl) = 0 Then Exit Sub
        baseUrlSource = "input"
    End If
    gBaseUrl = baseUrl
    gBaseUrlSource = baseUrlSource

    Dim login As String, token As String, credSource As String
    If Not LoadCredentials(login, token, credSource) Then
        login = InputBox("Jira login (username/email):", "Jira")
        If Len(login) = 0 Then Exit Sub

        token = InputBox("Jira API token / password:", "Jira")
        If Len(token) = 0 Then Exit Sub
        credSource = "input"
    End If
    gCredsSource = credSource

    ShowRunInfo login

    jira login, token
End Sub

' Сохраняю имя процедуры как на скриншоте
Public Sub jira(login As String, password As String)
    If Len(gBaseUrl) = 0 Then
        gBaseUrl = ResolveBaseUrl(gBaseUrlSource)
        If Len(gBaseUrl) = 0 Then
            gBaseUrl = InputBox("Jira base URL (например https://jira.company.com):", "Jira")
            gBaseUrl = NormalizeBaseUrl(gBaseUrl)
            If Len(gBaseUrl) = 0 Then Exit Sub
            gBaseUrlSource = "input"
        End If
    End If

    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(1)

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, KEY_COL).End(xlUp).Row
    If lastRow < FIRST_DATA_ROW Then Exit Sub

    Dim colStatus As Long, colAssignee As Long, colUpdated As Long, colSprint As Long, colComments As Long, colSubtasks As Long, colErr As Long, colDebug As Long, colResponse As Long
    colStatus = EnsureColumn(ws, H_STATUS)
    colAssignee = EnsureColumn(ws, H_ASSIGNEE)
    colUpdated = EnsureColumn(ws, H_UPDATED)
    colSprint = EnsureColumn(ws, H_SPRINT)
    colComments = EnsureColumn(ws, H_COMMENTS)
    colSubtasks = EnsureColumn(ws, H_SUBTASKS)
    colErr = EnsureColumn(ws, H_ERROR)
    If DEBUG_LOG Then
        colDebug = EnsureColumn(ws, H_DEBUG)
        colResponse = EnsureColumn(ws, H_RESPONSE)
    Else
        colDebug = 0
        colResponse = 0
    End If

    Dim authHeader As String
    authHeader = "Basic " & Base64Encode(login & ":" & password)

    Dim pingErr As String
    pingErr = JiraPing(authHeader)
    If Len(pingErr) > 0 Then
        MsgBox "Не удалось подключиться к Jira:" & vbCrLf & pingErr, vbExclamation, "Jira"
        Exit Sub
    End If

    Dim sprintFieldId As String
    sprintFieldId = ResolveSprintFieldId(authHeader)

    Dim prevCalc As XlCalculation
    prevCalc = Application.Calculation
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual

    Dim i As Long
    Dim key As String
    
    For i = FIRST_DATA_ROW To lastRow
        key = Trim(CStr(ws.Cells(i, KEY_COL).Value))
        If Len(key) > 0 Then
            ws.Cells(i, colErr).Value = ProcessIssueRow(ws, i, key, authHeader, sprintFieldId, _
                                                        colStatus, colAssignee, colUpdated, colSprint, _
                                                        colComments, colSubtasks, colDebug, colResponse)
        End If
    Next i

    Application.Calculation = prevCalc
    Application.EnableEvents = True
    Application.ScreenUpdating = True
End Sub

' ====== JIRA API ======

Private Function JiraGetIssue(ByVal authHeader As String, ByVal issueKey As String, ByVal sprintFieldId As String) As Object
    Dim fieldsParam As String
    fieldsParam = "fields=status,assignee,comment,updated,subtasks,issuetype," & sprintFieldId

    Dim url As String
    url = gBaseUrl & "/rest/api/2/issue/" & UrlEncode(issueKey) & "?" & fieldsParam
    SetLastRequestInfo "GET issue", url

    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "GET", url, False
    http.setRequestHeader "Authorization", authHeader
    http.setRequestHeader "Accept", "application/json"
    http.send
    SetLastResponseInfo http.Status, CStr(http.responseText)

    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise 5, , "JiraGetIssue HTTP " & http.Status & " (" & url & "): " & Left$(CStr(http.responseText), 500)
    End If

    Dim root As Object
    Set root = ParseJsonObject(CStr(http.responseText), "JiraGetIssue")
    Set JiraGetIssue = root
End Function

Private Function JiraSearchSubtasks(ByVal authHeader As String, ByVal parentKey As String) As Object
    Dim jql As String
    jql = "parent=" & parentKey

    Dim url As String
    url = gBaseUrl & "/rest/api/2/search?jql=" & UrlEncode(jql) & "&fields=summary,status&maxResults=100"
    SetLastRequestInfo "GET search", url

    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "GET", url, False
    http.setRequestHeader "Authorization", authHeader
    http.setRequestHeader "Accept", "application/json"
    http.send
    SetLastResponseInfo http.Status, CStr(http.responseText)

    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise 5, , "JiraSearchSubtasks HTTP " & http.Status & " (" & url & "): " & Left$(CStr(http.responseText), 500)
    End If

    Dim root As Object
    Set root = ParseJsonObject(CStr(http.responseText), "JiraSearchSubtasks")
    Set JiraSearchSubtasks = root
End Function

' ====== ПРЕОБРАЗОВАНИЯ В ТЕКСТ ДЛЯ EXCEL ======

Private Function CommentsToText(ByVal commentsVariant As Variant) As String
    On Error GoTo Fail

    If IsEmpty(commentsVariant) Or IsNull(commentsVariant) Then
        CommentsToText = vbNullString
        Exit Function
    End If

    If TypeName(commentsVariant) <> "Collection" Then
        CommentsToText = vbNullString
        Exit Function
    End If

    Dim col As Collection
    Set col = commentsVariant

    Dim out As String
    out = ""

    Dim i As Long
    For i = 1 To col.Count
        Dim c As Object
        Set c = col.Item(i)

        Dim created As String, author As String, body As String
        created = Nz(GetPath(c, "created"), "")
        author = Nz(GetPath(c, "author.displayName"), "")
        body = CommentBodyToText(GetField(c, "body"))

        body = Replace(body, vbCrLf, " ")
        body = Replace(body, vbCr, " ")
        body = Replace(body, vbLf, " ")

        If Len(out) > 0 Then out = out & vbLf
        out = out & created & " | " & author & " | " & body
    Next i

    CommentsToText = out
    Exit Function

Fail:
    CommentsToText = vbNullString
End Function

Private Function CommentBodyToText(ByVal bodyVar As Variant) As String
    ' Jira DC обычно отдаёт body как String, Jira Cloud может отдавать ADF как Object.
    If IsNull(bodyVar) Or IsEmpty(bodyVar) Then
        CommentBodyToText = ""
    ElseIf VarType(bodyVar) = vbString Then
        CommentBodyToText = CStr(bodyVar)
    ElseIf IsObject(bodyVar) Then
        CommentBodyToText = ExtractTextFromAdf(bodyVar)
    Else
        CommentBodyToText = CStr(bodyVar)
    End If
End Function

Private Function ExtractTextFromAdf(ByVal node As Variant) As String
    On Error GoTo Fail

    Dim t As String
    t = ""

    ' Если есть поле "text" — это текстовый узел
    Dim s As Variant
    s = GetField(node, "text")
    If Not IsNull(s) And Not IsEmpty(s) Then
        If VarType(s) = vbString Then
            ExtractTextFromAdf = CStr(s)
            Exit Function
        End If
    End If

    ' Рекурсивно обходим content[]
    Dim contentVar As Variant
    AssignVariant contentVar, GetField(node, "content")
    If TypeName(contentVar) = "Collection" Then
        Dim col As Collection
        Set col = contentVar
        Dim i As Long
        For i = 1 To col.Count
            If Len(t) > 0 Then t = t & " "
            t = t & ExtractTextFromAdf(col.Item(i))
        Next i
    End If

    ExtractTextFromAdf = Trim$(t)
    Exit Function

Fail:
    ExtractTextFromAdf = ""
End Function

Private Function SprintToText(ByVal sprintVar As Variant) As String
    On Error GoTo Fail

    If IsNull(sprintVar) Or IsEmpty(sprintVar) Then
        SprintToText = vbNullString
        Exit Function
    End If

    ' Иногда это массив (Collection) спринтов
    If TypeName(sprintVar) = "Collection" Then
        Dim col As Collection
        Set col = sprintVar
        Dim out As String
        out = ""
        Dim i As Long
        For i = 1 To col.Count
            Dim nameVar As Variant
            nameVar = GetField(col.Item(i), "name")
            If Not IsNull(nameVar) And Not IsEmpty(nameVar) Then
                If Len(out) > 0 Then out = out & ", "
                out = out & CStr(nameVar)
            End If
        Next i
        SprintToText = out
        Exit Function
    End If

    ' Иногда Jira DC отдаёт строку вида "...name=Sprint 12,goal=...,state=..."
    If VarType(sprintVar) = vbString Then
        Dim s As String
        s = CStr(sprintVar)
        Dim p As Long, q As Long
        p = InStr(1, s, "name=", vbTextCompare)
        If p > 0 Then
            p = p + Len("name=")
            q = InStr(p, s, ",", vbTextCompare)
            If q = 0 Then q = Len(s) + 1
            SprintToText = Mid$(s, p, q - p)
        Else
            SprintToText = s
        End If
        Exit Function
    End If

    SprintToText = CStr(sprintVar)
    Exit Function

Fail:
    SprintToText = vbNullString
End Function

Private Function SubtasksToTextIfAny(ByVal authHeader As String, ByVal parentKey As String, ByVal subtasksVariant As Variant) As String
    On Error GoTo Fail

    If TypeName(subtasksVariant) <> "Collection" Then
        SubtasksToTextIfAny = vbNullString
        Exit Function
    End If

    Dim st As Collection
    Set st = subtasksVariant
    If st.Count = 0 Then
        SubtasksToTextIfAny = vbNullString
        Exit Function
    End If

    ' Для summary+status делаем search parent=KEY
    SubtasksToTextIfAny = SubtasksToTextFromSearch(authHeader, parentKey)
    Exit Function

Fail:
    SubtasksToTextIfAny = vbNullString
End Function

Private Function SubtasksToTextFromSearch(ByVal authHeader As String, ByVal parentKey As String) As String
    On Error GoTo Fail

    Dim searchRes As Object
    Set searchRes = JiraSearchSubtasks(authHeader, parentKey)

    Dim issuesVar As Variant
    AssignVariant issuesVar, GetField(searchRes, "issues")

    If TypeName(issuesVar) <> "Collection" Then
        SubtasksToTextFromSearch = vbNullString
        Exit Function
    End If

    Dim issues As Collection
    Set issues = issuesVar

    If issues.Count = 0 Then
        SubtasksToTextFromSearch = vbNullString
        Exit Function
    End If

    Dim out As String
    out = ""

    Dim i As Long
    For i = 1 To issues.Count
        Dim it As Object
        Set it = issues.Item(i)

        Dim k As String, summ As String, st As String
        k = Nz(GetPath(it, "key"), "")
        summ = Nz(GetPath(it, "fields.summary"), "")
        st = Nz(GetPath(it, "fields.status.name"), "")

        If Len(out) > 0 Then out = out & vbLf
        out = out & k & " / " & summ & " / " & st
    Next i

    SubtasksToTextFromSearch = out
    Exit Function

Fail:
    SubtasksToTextFromSearch = vbNullString
End Function

Private Function ResolveSprintFieldId(ByVal authHeader As String) As String
    On Error GoTo Fallback

    ' Если константа задана нормально — используем её.
    If Len(Trim$(SPRINT_FIELD_ID)) > 0 Then
        If InStr(1, SPRINT_FIELD_ID, "XXXXX", vbTextCompare) = 0 Then
            ResolveSprintFieldId = SPRINT_FIELD_ID
            Exit Function
        End If
    End If

    ' Пытаемся как в `ujg-sprint-health.js`: /rest/api/2/field → field.name==="Sprint" && field.schema.customId
    Dim url As String
    url = gBaseUrl & "/rest/api/2/field"
    SetLastRequestInfo "GET field", url

    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "GET", url, False
    http.setRequestHeader "Authorization", authHeader
    http.setRequestHeader "Accept", "application/json"
    http.send
    SetLastResponseInfo http.Status, CStr(http.responseText)

    If http.Status < 200 Or http.Status >= 300 Then GoTo Fallback

    Dim root As Object
    Set root = ParseJsonObject(CStr(http.responseText), "ResolveSprintFieldId")
    If TypeName(root) <> "Collection" Then GoTo Fallback

    Dim fields As Collection
    Set fields = root

    Dim i As Long
    For i = 1 To fields.Count
        Dim f As Object
        Set f = fields.Item(i)

        Dim nm As Variant, fid As Variant, customId As Variant
        nm = GetField(f, "name")
        fid = GetField(f, "id")
        customId = GetField(f, "schema.customId")

        Dim nameStr As String
        nameStr = LCase$(Nz(nm, ""))

        If (nameStr = "sprint" Or nameStr = "спринт") Then
            If Len(Nz(fid, "")) > 0 And Len(Nz(customId, "")) > 0 Then
                ResolveSprintFieldId = CStr(fid)
                Exit Function
            End If
        End If
    Next i

Fallback:
    ResolveSprintFieldId = "customfield_10020"
End Function

' ====== УТИЛИТЫ (Excel / JSON / HTTP) ======

Private Function LoadCredentials(ByRef login As String, ByRef token As String, ByRef source As String) As Boolean
    On Error GoTo Fail

    Dim tokenEnvVar As String
    login = Trim$(Environ$(CRED_ENV_LOGIN))
    token = Trim$(Environ$(CRED_ENV_TOKEN))
    tokenEnvVar = CRED_ENV_TOKEN
    If Len(token) = 0 Then
        token = Trim$(Environ$(CRED_ENV_PASSWORD))
        tokenEnvVar = CRED_ENV_PASSWORD
    End If
    If Len(token) = 0 Then
        token = Trim$(Environ$(CRED_ENV_PASS))
        tokenEnvVar = CRED_ENV_PASS
    End If
    If Len(login) > 0 And Len(token) > 0 Then
        source = "env:" & CRED_ENV_LOGIN & "+" & tokenEnvVar
        LoadCredentials = True
        Exit Function
    End If

    login = ""
    token = ""
    source = ""

    Dim appData As String
    appData = Environ$("APPDATA")
    If Len(appData) > 0 Then
        Dim credPath As String
        credPath = appData & CRED_FILE_REL
        If ReadCredentialsFromFile(credPath, login, token) Then
            source = "file:" & credPath
            LoadCredentials = True
            Exit Function
        End If
    End If

    source = "none"
    LoadCredentials = False
    Exit Function

Fail:
    source = "error"
    LoadCredentials = False
End Function

Private Function ResolveBaseUrl(ByRef source As String) As String
    Dim url As String
    url = Trim$(Environ$(CRED_ENV_BASE_URL))
    If Len(url) > 0 Then
        source = "env:" & CRED_ENV_BASE_URL
    Else
        url = Trim$(Environ$(CRED_ENV_HOST))
        If Len(url) > 0 Then
            source = "env:" & CRED_ENV_HOST
        Else
            url = Trim$(Environ$(CRED_ENV_SITE))
            If Len(url) > 0 Then source = "env:" & CRED_ENV_SITE
        End If
    End If

    If Len(url) = 0 Then
        Dim appData As String
        appData = Environ$("APPDATA")
        If Len(appData) > 0 Then
            Dim filePath As String
            filePath = appData & CRED_FILE_REL
            url = ReadBaseUrlFromFile(filePath)
            If Len(url) > 0 Then source = "file:" & filePath
        End If
    End If

    If Len(url) = 0 Then
        url = Trim$(BASE_URL)
        If Len(url) > 0 Then source = "const:BASE_URL"
    End If
    If Len(url) = 0 Then source = "none"

    ResolveBaseUrl = NormalizeBaseUrl(url)
End Function

Private Function ReadBaseUrlFromFile(ByVal path As String) As String
    On Error GoTo Fail
    If Len(path) = 0 Then GoTo Fail
    If Len(Dir$(path, vbNormal)) = 0 Then GoTo Fail

    Dim f As Integer
    f = FreeFile
    Open path For Input As #f

    Dim line As String
    Dim url As String
    url = ""

    Do While Not EOF(f)
        Line Input #f, line
        line = Trim$(line)
        If Len(line) = 0 Then GoTo ContinueLoop
        If Left$(line, 1) = "#" Or Left$(line, 1) = "'" Then GoTo ContinueLoop

        Dim p As Long
        p = InStr(1, line, "=", vbTextCompare)
        If p > 0 Then
            Dim k As String, v As String
            k = LCase$(Trim$(Left$(line, p - 1)))
            v = Trim$(Mid$(line, p + 1))
            Select Case k
                Case "base_url", "url", "host", "site"
                    url = v
            End Select
        End If

ContinueLoop:
    Loop

    Close #f
    ReadBaseUrlFromFile = url
    Exit Function

Fail:
    On Error Resume Next
    If f <> 0 Then Close #f
    ReadBaseUrlFromFile = ""
End Function

Private Function NormalizeBaseUrl(ByVal raw As String) As String
    Dim s As String
    s = Trim$(raw)
    If Len(s) = 0 Then
        NormalizeBaseUrl = ""
        Exit Function
    End If

    Do While Right$(s, 1) = "/"
        s = Left$(s, Len(s) - 1)
    Loop

    If InStr(1, s, "://", vbTextCompare) = 0 Then
        s = "https://" & s
    End If

    NormalizeBaseUrl = s
End Function

Private Function ParseJsonObject(ByVal jsonText As String, ByVal context As String) As Object
    Dim v As Variant
    ' Используем ParseJsonInto чтобы корректно получить Object или примитив
    JsonConverter.ParseJsonInto jsonText, v
    If IsObject(v) Then
        Set ParseJsonObject = v
    Else
        If Len(context) = 0 Then context = "ParseJsonObject"
        Err.Raise 5, , context & ": unexpected JSON type " & TypeName(v)
    End If
End Function

Private Sub ShowRunInfo(ByVal login As String)
    Dim msg As String
    msg = "Jira URL: " & gBaseUrl & vbCrLf & _
          "Источник URL: " & NzText(gBaseUrlSource, "неизвестно") & vbCrLf & _
          "Версия скрипта: " & SCRIPT_VERSION & vbCrLf & _
          "Debug: " & IIf(DEBUG_LOG, "on", "off") & vbCrLf & _
          "Логин: " & login & vbCrLf & _
          "Источник логина/пароля: " & NzText(gCredsSource, "неизвестно") & vbCrLf & _
          "Пароль/токен: (скрыт)"
    MsgBox msg, vbInformation, "Jira: параметры"
End Sub

Private Sub SetLastRequestInfo(ByVal name As String, ByVal url As String)
    gLastRequestName = name
    gLastRequestUrl = url
    gLastRequestStatus = 0
    gLastResponseSnippet = ""
    gLastResponseFull = ""
End Sub

Private Sub SetLastResponseInfo(ByVal status As Long, ByVal responseText As String)
    gLastRequestStatus = status
    ' Полный ответ для колонки Response
    gLastResponseFull = CStr(responseText)
    ' Краткий snippet для колонки Debug
    Dim s As String
    s = Left$(CStr(responseText), 500)
    s = Replace(s, vbCrLf, " ")
    s = Replace(s, vbCr, " ")
    s = Replace(s, vbLf, " ")
    gLastResponseSnippet = s
End Sub

Private Function GetLastResponseFull() As String
    GetLastResponseFull = gLastResponseFull
End Function

Private Function FormatLastRequestDebug() As String
    Dim s As String
    s = ""
    If Len(gLastRequestName) > 0 Then s = s & gLastRequestName & " "
    s = s & gLastRequestUrl
    If gLastRequestStatus <> 0 Then s = s & " [HTTP " & gLastRequestStatus & "]"
    If Len(gLastResponseSnippet) > 0 Then s = s & " | " & gLastResponseSnippet
    FormatLastRequestDebug = Trim$(s)
End Function

Private Function JiraPing(ByVal authHeader As String) As String
    On Error GoTo Fail

    Dim url As String
    url = gBaseUrl & "/rest/api/2/myself"

    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "GET", url, False
    http.setRequestHeader "Authorization", authHeader
    http.setRequestHeader "Accept", "application/json"
    http.send

    If http.Status >= 200 And http.Status < 300 Then
        JiraPing = ""
        Exit Function
    End If

    Dim msg As String
    msg = "HTTP " & http.Status & " на " & url
    If http.Status = 404 Then
        msg = msg & vbCrLf & "Похоже, базовый URL неверный. Для Jira Server часто нужен суффикс /jira."
    ElseIf http.Status = 401 Or http.Status = 403 Then
        msg = msg & vbCrLf & "Проверь логин/пароль (или API token)."
    End If
    msg = msg & vbCrLf & Left$(CStr(http.responseText), 300)
    JiraPing = msg
    Exit Function

Fail:
    JiraPing = "Ошибка подключения: " & Err.Description
End Function

Private Function ReadCredentialsFromFile(ByVal path As String, ByRef login As String, ByRef token As String) As Boolean
    On Error GoTo Fail
    If Len(path) = 0 Then GoTo Fail

    If Len(Dir$(path, vbNormal)) = 0 Then GoTo Fail

    Dim f As Integer
    f = FreeFile
    Open path For Input As #f

    Dim line As String
    Do While Not EOF(f)
        Line Input #f, line
        line = Trim$(line)
        If Len(line) = 0 Then GoTo ContinueLoop
        If Left$(line, 1) = "#" Or Left$(line, 1) = "'" Then GoTo ContinueLoop

        Dim p As Long
        p = InStr(1, line, "=", vbTextCompare)
        If p > 0 Then
            Dim k As String, v As String
            k = LCase$(Trim$(Left$(line, p - 1)))
            v = Trim$(Mid$(line, p + 1))
            Select Case k
                Case "login", "username", "user", "email"
                    login = v
                Case "token", "password", "pass", "api_token", "apitoken"
                    token = v
            End Select
        End If

ContinueLoop:
    Loop

    Close #f

    ReadCredentialsFromFile = (Len(login) > 0 And Len(token) > 0)
    Exit Function

Fail:
    On Error Resume Next
    If f <> 0 Then Close #f
    ReadCredentialsFromFile = False
End Function

Private Function EnsureColumn(ByVal ws As Worksheet, ByVal header As String) As Long
    Dim lastCol As Long
    lastCol = ws.Cells(HEADER_ROW, ws.Columns.Count).End(xlToLeft).Column
    If lastCol < 1 Then lastCol = 1

    Dim c As Long
    For c = 1 To lastCol
        If Trim$(CStr(ws.Cells(HEADER_ROW, c).Value)) = header Then
            EnsureColumn = c
            Exit Function
        End If
    Next c

    EnsureColumn = lastCol + 1
    ws.Cells(HEADER_ROW, EnsureColumn).Value = header
End Function

Private Function Nz(ByVal v As Variant, ByVal fallback As String) As String
    If IsObject(v) Then
        Nz = fallback
    ElseIf IsNull(v) Or IsEmpty(v) Then
        Nz = fallback
    Else
        Nz = CStr(v)
    End If
End Function

Private Function NzText(ByVal v As String, ByVal fallback As String) As String
    If Len(Trim$(v)) = 0 Then
        NzText = fallback
    Else
        NzText = v
    End If
End Function

' Корректное присваивание Variant: если значение - Object, использует Set
Private Sub AssignVariant(ByRef target As Variant, ByVal source As Variant)
    If IsObject(source) Then
        Set target = source
    Else
        target = source
    End If
End Sub

Private Function ProcessIssueRow(ByVal ws As Worksheet, ByVal rowIndex As Long, ByVal key As String, _
                                 ByVal authHeader As String, ByVal sprintFieldId As String, _
                                 ByVal colStatus As Long, ByVal colAssignee As Long, ByVal colUpdated As Long, _
                                 ByVal colSprint As Long, ByVal colComments As Long, ByVal colSubtasks As Long, _
                                 ByVal colDebug As Long, ByVal colResponse As Long) As String
    On Error GoTo Fail

    Dim stepName As String
    Dim issue As Object

    stepName = "JiraGetIssue"
    Set issue = JiraGetIssue(authHeader, key, sprintFieldId)
    
    ' Всегда записываем запрос и ответ (для отладки)
    If colDebug > 0 Then
        ws.Cells(rowIndex, colDebug).Value = gLastRequestName & " " & gLastRequestUrl & " [HTTP " & gLastRequestStatus & "]"
    End If
    If colResponse > 0 Then
        ws.Cells(rowIndex, colResponse).Value = GetLastResponseFull()
    End If

    If issue Is Nothing Then
        ProcessIssueRow = "Не удалось загрузить задачу"
        Exit Function
    End If

    stepName = "fields.status.name"
    ws.Cells(rowIndex, colStatus).Value = Nz(GetPath(issue, "fields.status.name"), "-")

    stepName = "fields.assignee.displayName"
    ws.Cells(rowIndex, colAssignee).Value = Nz(GetPath(issue, "fields.assignee.displayName"), "-")

    stepName = "fields.updated"
    ws.Cells(rowIndex, colUpdated).Value = Nz(GetPath(issue, "fields.updated"), "-")

    stepName = "fields.sprint"
    ws.Cells(rowIndex, colSprint).Value = SprintToText(GetField(issue, "fields." & sprintFieldId))

    stepName = "fields.comment.comments"
    ws.Cells(rowIndex, colComments).Value = CommentsToText(GetField(issue, "fields.comment.comments"))

    stepName = "fields.subtasks"
    ws.Cells(rowIndex, colSubtasks).Value = SubtasksToTextIfAny(authHeader, key, GetField(issue, "fields.subtasks"))

    ' Успех - очищаем колонки debug/response чтобы не путать
    If colDebug > 0 Then ws.Cells(rowIndex, colDebug).Value = "OK: " & gLastRequestUrl
    If colResponse > 0 Then ws.Cells(rowIndex, colResponse).Value = ""

    ProcessIssueRow = vbNullString
    Exit Function

Fail:
    ' При ошибке обязательно записываем запрос и полный ответ
    If colDebug > 0 Then
        ws.Cells(rowIndex, colDebug).Value = "FAIL @ " & stepName & ": " & gLastRequestName & " " & gLastRequestUrl & " [HTTP " & gLastRequestStatus & "]"
    End If
    If colResponse > 0 Then
        ws.Cells(rowIndex, colResponse).Value = GetLastResponseFull()
    End If
    ProcessIssueRow = "ERR " & Err.Number & " @ " & stepName & ": " & Err.Description
End Function

Private Function GetField(ByVal root As Variant, ByVal path As String) As Variant
    ' path вида "fields.status.name" или "fields.comment.comments"
    Dim parts() As String
    parts = Split(path, ".")

    Dim cur As Variant
    AssignVariant cur, root

    Dim i As Long
    For i = LBound(parts) To UBound(parts)
        If Not IsObject(cur) Then
            GetField = Empty
            Exit Function
        End If

        Dim dict As Object
        Set dict = cur

        On Error Resume Next
        Dim exists As Boolean
        exists = dict.Exists(parts(i))
        If Err.Number <> 0 Then
            Err.Clear
            GetField = Empty
            Exit Function
        End If
        On Error GoTo 0

        If Not exists Then
            GetField = Empty
            Exit Function
        End If

        AssignVariant cur, dict.Item(parts(i))
    Next i

    If IsObject(cur) Then
        Set GetField = cur
    Else
        GetField = cur
    End If
End Function

Private Function GetPath(ByVal root As Variant, ByVal path As String) As Variant
    Dim v As Variant
    AssignVariant v, GetField(root, path)
    If IsObject(v) Then
        Set GetPath = v
    Else
        GetPath = v
    End If
End Function

Private Function Base64Encode(ByVal plainText As String) As String
    Dim bytes() As Byte
    bytes = StrConv(plainText, vbFromUnicode)

    Dim xml As Object, node As Object
    Set xml = CreateObject("MSXML2.DOMDocument.6.0")
    Set node = xml.createElement("b64")
    node.DataType = "bin.base64"
    node.nodeTypedValue = bytes
    Base64Encode = Replace(node.text, vbLf, "")
End Function

Private Function UrlEncode(ByVal s As String) As String
    ' Минимальный URL-encode для query и ключей
    Dim i As Long, ch As Integer
    Dim out As String
    out = ""

    For i = 1 To Len(s)
        ch = AscW(Mid$(s, i, 1))
        Select Case ch
            Case 48 To 57, 65 To 90, 97 To 122 ' 0-9A-Za-z
                out = out & ChrW$(ch)
            Case 45, 46, 95, 126 ' - . _ ~
                out = out & ChrW$(ch)
            Case 32
                out = out & "%20"
            Case Else
                out = out & "%" & Right$("0" & Hex$(ch And &HFF), 2)
        End Select
    Next i

    UrlEncode = out
End Function

