# No Pester required. Run: powershell -File tests/knowledge-bridge.tests.ps1
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts/start-knowledge-bridge.ps1'
if (!(Test-Path $scriptPath)) { throw 'FAIL: knowledge bridge implementation is missing' }
. $scriptPath -ConfluenceBaseUrl 'https://wiki.example/confluence' -LibraryOnly
$script:checks = 0
function Assert($Condition, $Message) {
    $script:checks++
    if (!$Condition) { throw "FAIL: $Message" }
}
function Rejects([scriptblock]$Action, $Message) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    Assert $rejected $Message
}
Assert ((ConvertTo-KBBaseUrl 'https://wiki.example/confluence/') -eq 'https://wiki.example/confluence') 'safe context path'
foreach ($bad in @('http://wiki.example', 'https://a:b@wiki.example', 'https://wiki.example/?q=x', 'https://wiki.example/#x', 'https://wiki.example/a/../b', 'https://wiki.example/a%2fb', 'https://wiki.example/a\b', 'https://wiki.example//b')) {
    Rejects { ConvertTo-KBBaseUrl $bad } "reject base $bad"
}
$script:requests = @()
$fake = {
    param($Uri, $Mode, $Secret)
    $script:requests += [string]$Uri
    @{ StatusCode = 200; ContentType = 'application/json; charset=utf-8'; Body = [Text.Encoding]::UTF8.GetBytes('{"ok":true}') }
}
function Route($Target = '/api/health', $Overrides = @{}) {
    $args = @{ Method='GET'; Target=$Target; HostHeader='localhost:8769'; Origin='http://localhost:8769'; FetchSite='same-origin'; Session='test-session'; ExpectedSession='test-session'; Port=8769; BaseUrl='https://wiki.example/confluence'; AuthMode='None'; Transport=$fake }
    foreach ($key in $Overrides.Keys) { $args[$key] = $Overrides[$key] }
    Invoke-KBRoute @args
}
Assert ((Route).Status -eq 200) 'health works'
Assert ($script:requests.Count -eq 0) 'health stays local'
foreach ($overrides in @(@{Method='POST'}, @{HostHeader='evil.test:8769'}, @{HostHeader='localhost:80'}, @{Origin='https://evil.test'}, @{FetchSite='cross-site'}, @{Session='wrong'}, @{Session=''}, @{RemoteAddress='192.0.2.1'})) {
    Assert ((Route '/api/health' $overrides).Status -ge 400) 'request boundary enforced'
}
Assert ((Route '/' @{Session=''}).Status -eq 200) 'root initializes session'
$html = (Route '/').Body
Assert ($html.Contains('test-session')) 'session embedded server-side'
Assert (!$html.Contains('innerHTML')) 'UI uses safe rendering'
Assert ($html.Contains('id="page"') -and $html.Contains('id="pageId"') -and $html.Contains("run('/api/confluence/page?id='")) 'numeric page read UI'
Assert ($html.Contains('<style nonce="test-session">')) 'nonce protected compact CSS'
Assert ((Route '/api/confluence/me').Status -eq 200) 'current user route'
Assert ($script:requests[-1] -eq 'https://wiki.example/confluence/rest/api/user/current') 'fixed current user endpoint'
Assert ((Route '/api/confluence/search?q=a%22%5Cb').Status -eq 200) 'search route'
$decoded = [Uri]::UnescapeDataString($script:requests[-1])
Assert ($decoded.Contains('cql=title~"a\"\\b"') -and $decoded.EndsWith('&limit=20')) 'CQL escaping and limit'
Assert ((Route '/api/confluence/page?id=123').Status -eq 200) 'page route'
Assert ($script:requests[-1].EndsWith('/rest/api/content/123?expand=body.storage,version')) 'fixed content endpoint'
foreach ($target in @('/api/confluence/page?id=../1', '/api/confluence/page?id=1&id=2', '/api/confluence/search?q=x&url=https://evil.test', '/api/confluence/search?q=%00', '/api/confluence/search?q=%ZZ', '/api/confluence/search?q=', '/api/confluence/search?q=' + ('x' * 257), '/api/proxy?url=https://evil.test', '//evil.test', '/api/confluence/me?x=1', '/api/%68ealth')) {
    $before = $script:requests.Count
    Assert ((Route $target).Status -ge 400) "reject target $target"
    Assert ($script:requests.Count -eq $before) 'invalid route never reaches transport'
}
foreach ($case in @(@{Code=401; Type='application/json'; Match='401'}, @{Code=403; Type='application/json'; Match='403'}, @{Code=429; Type='application/json'; Match='429'}, @{Code=302; Type='text/html'; Match='redirect'}, @{Code=200; Type='text/html'; Match='login'}, @{Code=200; Type='application/json'; Match='JSON'})) {
    $transport = { param($Uri,$Mode,$Secret) @{StatusCode=$case.Code; ContentType=$case.Type; Body=[Text.Encoding]::UTF8.GetBytes('<html>login</html>')} }.GetNewClosure()
    $result = Route '/api/confluence/me' @{Transport=$transport}
    Assert ($result.Status -ge 400 -and $result.Body -match $case.Match) "upstream error $($case.Match)"
}
$big = { param($Uri,$Mode,$Secret) @{StatusCode=200; ContentType='application/json'; Body=(New-Object byte[] (2097153))} }
Assert ((Route '/api/confluence/me' @{Transport=$big}).Status -eq 502) 'fake response size bound'
$broken = { throw 'secret credential and private upstream detail' }
$result = Route '/api/confluence/me' @{Transport=$broken}
Assert ($result.Status -eq 502 -and $result.Body -notmatch 'credential|private') 'transport errors sanitized'
$stream = New-Object IO.MemoryStream (,[byte[]](1,2,3,4))
try { Rejects { Read-KBBoundedStream $stream 3 } 'streaming size bound' } finally { $stream.Dispose() }
$stream = New-Object IO.MemoryStream (,[byte[]](1,2,3))
try { Assert ((Read-KBBoundedStream $stream 3).Length -eq 3) 'exact bound accepted' } finally { $stream.Dispose() }
Assert ((New-KBSession) -match '^[a-f0-9]{64}$') '256-bit session format'
Assert ((New-KBSession) -ne (New-KBSession)) 'unique sessions'
foreach ($mode in @('None','Windows','Token')) {
    $request = New-KBRequest ([Uri]'https://wiki.example/rest/api/user/current') $mode
    try {
        Assert ($request.Method -eq 'GET' -and !$request.AllowAutoRedirect) 'read-only transport without redirects'
        Assert ($request.Timeout -eq 15000 -and $request.ReadWriteTimeout -eq 15000) 'transport timeouts'
        Assert ($request.UseDefaultCredentials -eq ($mode -eq 'Windows')) 'default credentials only in explicit Windows mode'
        Assert (!$request.Headers['Authorization']) 'no implicit token credentials'
    } finally { $request.Abort() }
}
$stream = New-Object IO.MemoryStream (,[byte[]](1,2,3))
try { Rejects { Read-KBBoundedStream $stream 3 ([pscustomobject]@{ElapsedMilliseconds=15001}) } 'total response deadline' } finally { $stream.Dispose() }
Write-Host "PASS: $script:checks checks"
