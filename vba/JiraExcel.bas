Attribute VB_Name = "JiraExcel"
Option Explicit

' ====== НАСТРОЙКИ (под себя) ======
Private Const BASE_URL As String = "https://jira.dc-prod.tn.corp"

' В Jira поле "Sprint" почти всегда customfield_XXXXX.
' В JS-виджете `ujg-sprint-health.js` поле Sprint резолвится автоматически через /rest/api/2/field,
' а если не найдено — используется fallback customfield_10020. Здесь делаем то же.
Private Const SPRINT_FIELD_ID As String = "customfield_10020"

' Где в Excel искать ключи задач (как в твоём коде со скриншота):
Private Const KEY_COL As Long = 11          ' колонка с ключом (K)
Private Const HEADER_ROW As Long = 9        ' строка заголовков
Private Const FIRST_DATA_ROW As Long = 10   ' первая строка данных

' Заголовки создаваемых/ищущихся колонок:
Private Const H_STATUS As String = "Jira: Статус"
Private Const H_ASSIGNEE As String = "Jira: Исполнитель"
Private Const H_UPDATED As String = "Jira: Последнее обновление"
Private Const H_SPRINT As String = "Jira: Спринт"
Private Const H_COMMENTS As String = "Jira: Комментарии (время | автор | текст)"
Private Const H_SUBTASKS As String = "Jira: Детки (key / summary / status)"
Private Const H_ERROR As String = "Jira: Ошибка"

' ====== ПУБЛИЧНЫЕ ТОЧКИ ВХОДА ======

Public Sub RunJiraUpdate()
    Dim login As String, token As String
    login = InputBox("Jira login (username/email):", "Jira")
    If Len(login) = 0 Then Exit Sub

    token = InputBox("Jira API token / password:", "Jira")
    If Len(token) = 0 Then Exit Sub

    jira login, token
End Sub

' Сохраняю имя процедуры как на скриншоте
Public Sub jira(login As String, password As String)
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(1)

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, KEY_COL).End(xlUp).Row
    If lastRow < FIRST_DATA_ROW Then Exit Sub

    Dim colStatus As Long, colAssignee As Long, colUpdated As Long, colSprint As Long, colComments As Long, colSubtasks As Long, colErr As Long
    colStatus = EnsureColumn(ws, H_STATUS)
    colAssignee = EnsureColumn(ws, H_ASSIGNEE)
    colUpdated = EnsureColumn(ws, H_UPDATED)
    colSprint = EnsureColumn(ws, H_SPRINT)
    colComments = EnsureColumn(ws, H_COMMENTS)
    colSubtasks = EnsureColumn(ws, H_SUBTASKS)
    colErr = EnsureColumn(ws, H_ERROR)

    Dim authHeader As String
    authHeader = "Basic " & Base64Encode(login & ":" & password)

    Dim sprintFieldId As String
    sprintFieldId = ResolveSprintFieldId(authHeader)

    Dim prevCalc As XlCalculation
    prevCalc = Application.Calculation
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual

    On Error GoTo CleanFail

    Dim i As Long
    For i = FIRST_DATA_ROW To lastRow
        Dim key As String
        key = Trim(CStr(ws.Cells(i, KEY_COL).Value))

        If Len(key) = 0 Then
            ' пустая строка — ничего не делаем
        Else
            On Error GoTo RowFail
            ws.Cells(i, colErr).Value = vbNullString

            Dim issue As Variant
            Set issue = JiraGetIssue(authHeader, key, sprintFieldId)

            ' Достаём основные поля
            ws.Cells(i, colStatus).Value = Nz(GetPath(issue, "fields.status.name"), "-")
            ws.Cells(i, colAssignee).Value = Nz(GetPath(issue, "fields.assignee.displayName"), "-")
            ws.Cells(i, colUpdated).Value = Nz(GetPath(issue, "fields.updated"), "-")
            ws.Cells(i, colSprint).Value = SprintToText(GetField(issue, "fields." & sprintFieldId))
            ws.Cells(i, colComments).Value = CommentsToText(GetField(issue, "fields.comment.comments"))

            ' Деток тянем только если они есть
            ws.Cells(i, colSubtasks).Value = SubtasksToTextIfAny(authHeader, key, GetField(issue, "fields.subtasks"))

            On Error GoTo 0
        End If
ContinueRow:
    Next i

CleanExit:
    Application.Calculation = prevCalc
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Exit Sub

CleanFail:
    ' Если упали в середине — восстановим Excel и покажем ошибку
    Application.Calculation = prevCalc
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    MsgBox "Ошибка: " & Err.Description, vbCritical
End Sub

RowFail:
    ws.Cells(i, colErr).Value = Err.Description
    Resume ContinueRow

' ====== JIRA API ======

Private Function JiraGetIssue(ByVal authHeader As String, ByVal issueKey As String) As Object
    Dim fieldsParam As String
    fieldsParam = "fields=status,assignee,comment,updated,subtasks,issuetype," & SPRINT_FIELD_ID

    Dim url As String
    url = BASE_URL & "/rest/api/2/issue/" & UrlEncode(issueKey) & "?" & fieldsParam

    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "GET", url, False
    http.setRequestHeader "Authorization", authHeader
    http.setRequestHeader "Accept", "application/json"
    http.send

    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise 5, , "JiraGetIssue HTTP " & http.Status & ": " & Left$(CStr(http.responseText), 500)
    End If

    Dim root As Variant
    root = JsonConverter.ParseJson(CStr(http.responseText))
    Set JiraGetIssue = root
End Function

Private Function JiraGetIssue(ByVal authHeader As String, ByVal issueKey As String, ByVal sprintFieldId As String) As Object
    Dim fieldsParam As String
    fieldsParam = "fields=status,assignee,comment,updated,subtasks,issuetype," & sprintFieldId

    Dim url As String
    url = BASE_URL & "/rest/api/2/issue/" & UrlEncode(issueKey) & "?" & fieldsParam

    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "GET", url, False
    http.setRequestHeader "Authorization", authHeader
    http.setRequestHeader "Accept", "application/json"
    http.send

    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise 5, , "JiraGetIssue HTTP " & http.Status & ": " & Left$(CStr(http.responseText), 500)
    End If

    Dim root As Variant
    root = JsonConverter.ParseJson(CStr(http.responseText))
    Set JiraGetIssue = root
End Function

Private Function JiraSearchSubtasks(ByVal authHeader As String, ByVal parentKey As String) As Object
    Dim jql As String
    jql = "parent=" & parentKey

    Dim url As String
    url = BASE_URL & "/rest/api/2/search?jql=" & UrlEncode(jql) & "&fields=summary,status&maxResults=100"

    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "GET", url, False
    http.setRequestHeader "Authorization", authHeader
    http.setRequestHeader "Accept", "application/json"
    http.send

    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise 5, , "JiraSearchSubtasks HTTP " & http.Status & ": " & Left$(CStr(http.responseText), 500)
    End If

    Dim root As Variant
    root = JsonConverter.ParseJson(CStr(http.responseText))
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
        Dim c As Variant
        c = col.Item(i)

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
    contentVar = GetField(node, "content")
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
    issuesVar = GetField(searchRes, "issues")

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
        Dim it As Variant
        it = issues.Item(i)

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
    url = BASE_URL & "/rest/api/2/field"

    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "GET", url, False
    http.setRequestHeader "Authorization", authHeader
    http.setRequestHeader "Accept", "application/json"
    http.send

    If http.Status < 200 Or http.Status >= 300 Then GoTo Fallback

    Dim root As Variant
    root = JsonConverter.ParseJson(CStr(http.responseText))
    If TypeName(root) <> "Collection" Then GoTo Fallback

    Dim fields As Collection
    Set fields = root

    Dim i As Long
    For i = 1 To fields.Count
        Dim f As Variant
        f = fields.Item(i)

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
    If IsNull(v) Or IsEmpty(v) Then
        Nz = fallback
    Else
        Nz = CStr(v)
    End If
End Function

Private Function GetField(ByVal root As Variant, ByVal path As String) As Variant
    ' path вида "fields.status.name" или "fields.comment.comments"
    Dim parts() As String
    parts = Split(path, ".")

    Dim cur As Variant
    cur = root

    Dim i As Long
    For i = LBound(parts) To UBound(parts)
        If Not IsObject(cur) Then
            GetField = Empty
            Exit Function
        End If

        Dim dict As Object
        Set dict = cur
        If Not dict.Exists(parts(i)) Then
            GetField = Empty
            Exit Function
        End If
        cur = dict.Item(parts(i))
    Next i

    GetField = cur
End Function

Private Function GetPath(ByVal root As Variant, ByVal path As String) As Variant
    GetPath = GetField(root, path)
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

