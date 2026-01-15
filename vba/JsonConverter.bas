Attribute VB_Name = "JsonConverter"
Option Explicit

' Минималистичный JSON-парсер на чистом VBA (без ScriptControl).
' Возвращает:
' - Object(JSON object)  -> Scripting.Dictionary (late-bound)
' - Array(JSON array)   -> VBA Collection
' - String/Double/Boolean/Null -> соответствующий Variant
'
' Использование:
'   Dim root As Variant
'   Set root = ParseJson(responseText)
'

Private m_Pos As Long
Private m_Text As String

Public Function ParseJson(ByVal jsonText As String) As Variant
    m_Text = jsonText
    m_Pos = 1
    SkipWs
    ParseJson = ParseValue()
    SkipWs
End Function

Private Function ParseValue() As Variant
    SkipWs
    If m_Pos > Len(m_Text) Then Err.Raise 5, , "JSON: unexpected end"

    Dim ch As String
    ch = Mid$(m_Text, m_Pos, 1)

    Select Case ch
        Case "{"
            Dim obj As Object
            Set obj = ParseObject()
            Set ParseValue = obj
        Case "["
            Dim arr As Collection
            Set arr = ParseArray()
            Set ParseValue = arr
        Case """"
            ParseValue = ParseString()
        Case "t"
            ExpectLiteral "true"
            ParseValue = True
        Case "f"
            ExpectLiteral "false"
            ParseValue = False
        Case "n"
            ExpectLiteral "null"
            ParseValue = Null
        Case "-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"
            ParseValue = ParseNumber()
        Case Else
            Err.Raise 5, , "JSON: unexpected token '" & ch & "' at " & m_Pos
    End Select
End Function

Private Function ParseObject() As Object
    ' {
    AssertChar "{"
    m_Pos = m_Pos + 1
    SkipWs

    Dim dict As Object
    Set dict = CreateObject("Scripting.Dictionary")
    dict.CompareMode = 1 ' TextCompare

    If PeekChar = "}" Then
        m_Pos = m_Pos + 1
        Set ParseObject = dict
        Exit Function
    End If

    Do
        SkipWs
        Dim key As String
        key = ParseString()
        SkipWs
        AssertChar ":"
        m_Pos = m_Pos + 1
        SkipWs

        Dim v As Variant
        v = ParseValue()

        If dict.Exists(key) Then
            dict.Remove key
        End If
        dict.Add key, v

        SkipWs
        Dim ch As String
        ch = PeekChar
        If ch = "}" Then
            m_Pos = m_Pos + 1
            Exit Do
        ElseIf ch = "," Then
            m_Pos = m_Pos + 1
        Else
            Err.Raise 5, , "JSON: expected ',' or '}' at " & m_Pos
        End If
    Loop

    Set ParseObject = dict
End Function

Private Function ParseArray() As Collection
    ' [
    AssertChar "["
    m_Pos = m_Pos + 1
    SkipWs

    Dim col As New Collection

    If PeekChar = "]" Then
        m_Pos = m_Pos + 1
        Set ParseArray = col
        Exit Function
    End If

    Do
        Dim v As Variant
        v = ParseValue()
        col.Add v

        SkipWs
        Dim ch As String
        ch = PeekChar
        If ch = "]" Then
            m_Pos = m_Pos + 1
            Exit Do
        ElseIf ch = "," Then
            m_Pos = m_Pos + 1
        Else
            Err.Raise 5, , "JSON: expected ',' or ']' at " & m_Pos
        End If
    Loop

    Set ParseArray = col
End Function

Private Function ParseString() As String
    AssertChar """"
    m_Pos = m_Pos + 1

    Dim sb As String
    sb = ""

    Do While m_Pos <= Len(m_Text)
        Dim ch As String
        ch = Mid$(m_Text, m_Pos, 1)

        If ch = """" Then
            m_Pos = m_Pos + 1
            ParseString = sb
            Exit Function
        ElseIf ch = "\" Then
            m_Pos = m_Pos + 1
            If m_Pos > Len(m_Text) Then Err.Raise 5, , "JSON: bad escape"
            ch = Mid$(m_Text, m_Pos, 1)
            Select Case ch
                Case """": sb = sb & """"
                Case "\": sb = sb & "\"
                Case "/": sb = sb & "/"
                Case "b": sb = sb & Chr$(8)
                Case "f": sb = sb & Chr$(12)
                Case "n": sb = sb & vbLf
                Case "r": sb = sb & vbCr
                Case "t": sb = sb & vbTab
                Case "u"
                    Dim hex4 As String
                    hex4 = Mid$(m_Text, m_Pos + 1, 4)
                    If Len(hex4) <> 4 Then Err.Raise 5, , "JSON: bad unicode escape"
                    sb = sb & ChrW$(CLng("&H" & hex4))
                    m_Pos = m_Pos + 4
                Case Else
                    Err.Raise 5, , "JSON: unknown escape \" & ch & """"
            End Select
        Else
            sb = sb & ch
        End If
        m_Pos = m_Pos + 1
    Loop

    Err.Raise 5, , "JSON: unterminated string"
End Function

Private Function ParseNumber() As Double
    Dim startPos As Long
    startPos = m_Pos

    Dim ch As String
    ch = PeekChar
    If ch = "-" Then m_Pos = m_Pos + 1

    Do While m_Pos <= Len(m_Text)
        ch = Mid$(m_Text, m_Pos, 1)
        If ch >= "0" And ch <= "9" Then
            m_Pos = m_Pos + 1
        Else
            Exit Do
        End If
    Loop

    If PeekChar = "." Then
        m_Pos = m_Pos + 1
        Do While m_Pos <= Len(m_Text)
            ch = Mid$(m_Text, m_Pos, 1)
            If ch >= "0" And ch <= "9" Then
                m_Pos = m_Pos + 1
            Else
                Exit Do
            End If
        Loop
    End If

    ch = PeekChar
    If ch = "e" Or ch = "E" Then
        m_Pos = m_Pos + 1
        ch = PeekChar
        If ch = "+" Or ch = "-" Then m_Pos = m_Pos + 1
        Do While m_Pos <= Len(m_Text)
            ch = Mid$(m_Text, m_Pos, 1)
            If ch >= "0" And ch <= "9" Then
                m_Pos = m_Pos + 1
            Else
                Exit Do
            End If
        Loop
    End If

    Dim numText As String
    numText = Mid$(m_Text, startPos, m_Pos - startPos)
    ParseNumber = CDbl(numText)
End Function

Private Sub ExpectLiteral(ByVal lit As String)
    If Mid$(m_Text, m_Pos, Len(lit)) <> lit Then
        Err.Raise 5, , "JSON: expected '" & lit & "' at " & m_Pos
    End If
    m_Pos = m_Pos + Len(lit)
End Sub

Private Sub SkipWs()
    Do While m_Pos <= Len(m_Text)
        Dim ch As String
        ch = Mid$(m_Text, m_Pos, 1)
        Select Case ch
            Case " ", vbTab, vbCr, vbLf
                m_Pos = m_Pos + 1
            Case Else
                Exit Do
        End Select
    Loop
End Sub

Private Function PeekChar() As String
    If m_Pos > Len(m_Text) Then
        PeekChar = vbNullString
    Else
        PeekChar = Mid$(m_Text, m_Pos, 1)
    End If
End Function

Private Sub AssertChar(ByVal ch As String)
    If PeekChar <> ch Then
        Err.Raise 5, , "JSON: expected '" & ch & "' at " & m_Pos
    End If
End Sub

