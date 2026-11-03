#Requires -Version 5.1
<#
Standalone local Confluence read-only diagnostics. Download and review this pinned file
before running in your VDI. No installation, remote script fetching, or policy changes.
Example: .\start-knowledge-bridge.ps1 -ConfluenceBaseUrl https://wiki.example/confluence
Token mode prompts privately for a personal bearer token; Windows auth is opt-in.
Tests may dot-source with -LibraryOnly; this never prompts or starts a listener.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ConfluenceBaseUrl,
    [ValidateSet('None','Windows','Token')][string]$AuthMode = 'None',
    [ValidateRange(1024,65535)][int]$Port = 8769,
    [switch]$NoBrowser,
    [switch]$LibraryOnly
)

function ConvertTo-KBBaseUrl([string]$Value) {
    # Validate before URI normalization can hide traversal, escaped separators, etc.
    if ($Value -notmatch '^https://[^/?#\\\s]+(?:/[A-Za-z0-9._~-]+)*/?$' -or
        $Value -match '/\.{1,2}(?:/|$)') { throw 'ConfluenceBaseUrl must be an HTTPS origin with an optional safe context path.' }
    $uri = $null
    if (![Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'https' -or $uri.UserInfo -or !$uri.Host -or $uri.Query -or $uri.Fragment) {
        throw 'ConfluenceBaseUrl must be an HTTPS origin without credentials, query, or fragment.'
    }
    $uri.AbsoluteUri.TrimEnd('/')
}
function New-KBSession {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
}
function New-KBResult([int]$Status, [string]$Message, [string]$Type = 'application/json; charset=utf-8') {
    if ($Type.StartsWith('application/json')) { $Message = ConvertTo-Json -Compress @{error=$Message} }
    @{Status=$Status; Body=$Message; ContentType=$Type}
}
function Read-KBBoundedStream($Stream, [int]$MaxBytes = 2097152, $Watch = $null) {
    $memory = New-Object IO.MemoryStream
    $buffer = New-Object byte[] 8192
    try {
        while ($true) {
            if ($null -ne $Watch) {
                $remaining = 15000 - [int]$Watch.ElapsedMilliseconds
                if ($remaining -le 0) { throw 'Upstream timeout.' }
                if ($Stream.CanTimeout) { $Stream.ReadTimeout = $remaining }
            }
            $count = $Stream.Read($buffer, 0, [Math]::Min($buffer.Length, $MaxBytes + 1 - [int]$memory.Length))
            if ($count -eq 0) { break }
            if ($memory.Length + $count -gt $MaxBytes) { throw 'Upstream response exceeds 2 MB.' }
            $memory.Write($buffer, 0, $count)
        }
        if ($null -ne $Watch -and $Watch.ElapsedMilliseconds -ge 15000) { throw 'Upstream timeout.' }
        return ,$memory.ToArray()
    } finally { $memory.Dispose() }
}
function New-KBRequest([Uri]$Uri, [string]$Mode) {
    $request = [Net.HttpWebRequest]::Create($Uri)
    $request.Method = 'GET'
    $request.AllowAutoRedirect = $false
    $request.Timeout = 15000
    $request.ReadWriteTimeout = 15000
    $request.Accept = 'application/json'
    $request.UseDefaultCredentials = ($Mode -eq 'Windows')
    $request.CookieContainer = New-Object Net.CookieContainer
    $request.AutomaticDecompression = [Net.DecompressionMethods]::None
    $request
}
function Invoke-KBTransport([Uri]$Uri, [string]$Mode, [Security.SecureString]$Secret) {
    $request = New-KBRequest $Uri $Mode
    $response = $null
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        if ($Mode -eq 'Token') {
            if ($null -eq $Secret -or $Secret.Length -eq 0) { throw 'Token required.' }
            $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
            try {
                $request.Headers['Authorization'] = 'Bearer ' + [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
            } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
        }
        try { $response = $request.GetResponse() } catch [Net.WebException] {
            if ($null -eq $_.Exception.Response) { throw }
            $response = $_.Exception.Response
        }
        $status = [int]$response.StatusCode
        $body = [byte[]]@()
        # Do not read login pages, redirects, or upstream error bodies.
        if ($status -ge 200 -and $status -lt 300 -and $response.ContentType -match '^application/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)') {
            if ($response.ContentLength -gt 2097152) { throw 'Response too large.' }
            $stream = $response.GetResponseStream()
            try { $body = Read-KBBoundedStream $stream 2097152 $watch } finally { $stream.Dispose() }
        }
        @{StatusCode=$status; ContentType=$response.ContentType; Body=$body}
    } finally {
        $request.Headers.Remove('Authorization')
        if ($null -ne $response) { $response.Close() }
        $request.Abort()
        $watch.Stop()
    }
}
function Get-KBHtml([string]$Session) {
    # Session is generated locally; encode even test-supplied values for the JS context.
    $sessionJson = ConvertTo-Json -Compress $Session
    $sessionJson = $sessionJson.Replace('<','\u003c').Replace('>','\u003e').Replace('&','\u0026')
    $html = @'
<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Confluence: local diagnostics</title>
<style nonce="__NONCE__">
body{font:16px/1.5 system-ui,sans-serif;max-width:880px;margin:36px auto;padding:0 20px;color:#1d2939;background:#f7f9fb}
h1{font-size:1.6rem}button,input{font:inherit;padding:8px 12px;border:1px solid #8494a7;border-radius:5px}
button{background:#fff;color:#174ea6;cursor:pointer}button:hover{background:#e8f0fe}form{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:18px 0}
input{min-width:160px;flex:1}pre{background:#fff;border:1px solid #cad3df;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere;min-height:80px}
:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
</style>
<body><h1>Confluence: &#1076;&#1080;&#1072;&#1075;&#1085;&#1086;&#1089;&#1090;&#1080;&#1082;&#1072;</h1>
<p>&#1051;&#1086;&#1082;&#1072;&#1083;&#1100;&#1085;&#1072;&#1103; &#1087;&#1088;&#1086;&#1074;&#1077;&#1088;&#1082;&#1072; &#1087;&#1086;&#1076;&#1082;&#1083;&#1102;&#1095;&#1077;&#1085;&#1080;&#1103;. &#1069;&#1090;&#1086; &#1085;&#1077; &#1095;&#1072;&#1090;.</p>
<button id="health">&#1055;&#1088;&#1086;&#1074;&#1077;&#1088;&#1080;&#1090;&#1100; &#1089;&#1077;&#1088;&#1074;&#1077;&#1088;</button>
<button id="me">&#1058;&#1077;&#1082;&#1091;&#1097;&#1080;&#1081; &#1087;&#1086;&#1083;&#1100;&#1079;&#1086;&#1074;&#1072;&#1090;&#1077;&#1083;&#1100;</button>
<form id="search"><label for="q">&#1055;&#1086;&#1080;&#1089;&#1082; &#1087;&#1086; &#1079;&#1072;&#1075;&#1086;&#1083;&#1086;&#1074;&#1082;&#1091;</label>
<input id="q" maxlength="256" required><button>&#1053;&#1072;&#1081;&#1090;&#1080;</button></form>
<form id="page"><label for="pageId">&#1057;&#1090;&#1088;&#1072;&#1085;&#1080;&#1094;&#1072; ID</label>
<input id="pageId" inputmode="numeric" pattern="[0-9]{1,20}" maxlength="20" required><button>&#1055;&#1088;&#1086;&#1095;&#1080;&#1090;&#1072;&#1090;&#1100;</button></form>
<pre id="result" role="status" aria-live="polite"></pre>
<script nonce="__NONCE__">
'use strict';
const session = __SESSION__;
const result = document.getElementById('result');
async function run(path) {
  result.textContent = '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...';
  try {
    const response = await fetch(path, {headers:{'X-Knowledge-Session':session}, credentials:'omit', cache:'no-store', redirect:'error'});
    const data = await response.json();
    result.textContent = response.status + '\n' + JSON.stringify(data, null, 2);
  } catch (_) { result.textContent = '\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u044f'; }
}
document.getElementById('health').onclick = () => run('/api/health');
document.getElementById('me').onclick = () => run('/api/confluence/me');
document.getElementById('search').onsubmit = event => { event.preventDefault(); run('/api/confluence/search?q=' + encodeURIComponent(document.getElementById('q').value)); };
document.getElementById('page').onsubmit = event => { event.preventDefault(); run('/api/confluence/page?id=' + encodeURIComponent(document.getElementById('pageId').value)); };
</script></body></html>
'@
    $html.Replace('__SESSION__', $sessionJson).Replace('__NONCE__', $Session)
}
function Invoke-KBRoute {
    param([string]$Method, [string]$Target, [string]$HostHeader, [string]$Origin,
        [string]$FetchSite, [string]$Session, [string]$ExpectedSession, [int]$Port,
        [string]$BaseUrl, [string]$AuthMode = 'None', [Security.SecureString]$Token,
        [scriptblock]$Transport = ${function:Invoke-KBTransport}, [string]$RemoteAddress = '127.0.0.1')
    $ip = $null
    if (![Net.IPAddress]::TryParse($RemoteAddress, [ref]$ip) -or ![Net.IPAddress]::IsLoopback($ip) -or
        $HostHeader -ine "localhost:$Port") { return New-KBResult 403 'Loopback localhost host and exact port required.' }
    if (($Origin -and $Origin -cne "http://localhost:$Port") -or $FetchSite -ieq 'cross-site') { return New-KBResult 403 'Foreign origin denied.' }
    if ($Method -cne 'GET') { return New-KBResult 405 'GET only.' }
    if ($Target -ceq '/') { return New-KBResult 200 (Get-KBHtml $ExpectedSession) 'text/html; charset=utf-8' }
    if (!$ExpectedSession -or $Session -cne $ExpectedSession) { return New-KBResult 403 'Local session header required. Open the local diagnostic page.' }
    if ($Target -ceq '/api/health') { return @{Status=200; Body='{"ok":true,"service":"local-confluence-read-only"}'; ContentType='application/json; charset=utf-8'} }
    $suffix = $null
    if ($Target -ceq '/api/confluence/me') { $suffix = '/rest/api/user/current' }
    elseif ($Target -cmatch '^/api/confluence/page\?id=([0-9]{1,20})$') { $suffix = '/rest/api/content/' + $Matches[1] + '?expand=body.storage,version' }
    elseif ($Target -cmatch '^/api/confluence/search\?q=([^&\#]{1,3072})$') {
        $raw = $Matches[1]
        if ($raw -match '%(?![0-9a-fA-F]{2})') { return New-KBResult 400 'Invalid search encoding.' }
        $q = [Uri]::UnescapeDataString($raw.Replace('+',' '))
        if ([string]::IsNullOrWhiteSpace($q) -or $q.Length -gt 256 -or $q -match '[\x00-\x1f\x7f]') { return New-KBResult 400 'Search must contain 1-256 printable characters.' }
        $cql = 'title~"' + $q.Replace('\','\\').Replace('"','\"') + '"'
        $suffix = '/rest/api/content/search?cql=' + [Uri]::EscapeDataString($cql) + '&limit=20'
    }
    if (!$suffix) { return New-KBResult 404 'Unknown read-only route or invalid parameters.' }
    try {
        $safeBase = ConvertTo-KBBaseUrl $BaseUrl
        $upstream = & $Transport ([Uri]($safeBase + $suffix)) $AuthMode $Token
        $code = [int]$upstream.StatusCode
        if ($code -eq 401) { return New-KBResult 401 'Confluence returned 401: authentication required. Choose an explicit supported auth mode.' }
        if ($code -eq 403) { return New-KBResult 403 'Confluence returned 403: this user lacks permission.' }
        if ($code -eq 429) { return New-KBResult 429 'Confluence returned 429: rate limit reached. Wait before trying again.' }
        if ($code -ge 300 -and $code -lt 400) { return New-KBResult 502 'Confluence redirect blocked; an interactive SSO login may be required.' }
        if ($code -lt 200 -or $code -ge 300) { return New-KBResult 502 'Confluence returned an upstream error.' }
        if ($upstream.ContentType -notmatch '^application/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)') { return New-KBResult 502 'Confluence returned non-JSON content, possibly an HTML login page.' }
        if ($upstream.Body.Length -gt 2097152) { return New-KBResult 502 'Confluence response exceeds 2 MB.' }
        $json = [Text.Encoding]::UTF8.GetString([byte[]]$upstream.Body)
        try { $null = ConvertFrom-Json -InputObject $json -ErrorAction Stop } catch { return New-KBResult 502 'Confluence returned invalid JSON, possibly an HTML login page.' }
        if ([string]::IsNullOrWhiteSpace($json)) { return New-KBResult 502 'Confluence returned empty JSON.' }
        @{Status=200; Body=$json; ContentType='application/json; charset=utf-8'}
    } catch { New-KBResult 502 'Confluence connection failed, timed out (15 seconds), or exceeded 2 MB. Check VPN, TLS trust, URL, and authentication locally.' }
}
function Write-KBResponse($Response, $Result, [string]$Nonce) {
    try {
        $Response.StatusCode = $Result.Status
        $Response.ContentType = $Result.ContentType
        $Response.Headers['Cache-Control'] = 'no-store'
        $Response.Headers['Pragma'] = 'no-cache'
        $Response.Headers['X-Content-Type-Options'] = 'nosniff'
        $Response.Headers['X-Frame-Options'] = 'DENY'
        $Response.Headers['Referrer-Policy'] = 'no-referrer'
        $Response.Headers['Content-Security-Policy'] = "default-src 'none'; script-src 'nonce-$Nonce'; style-src 'nonce-$Nonce'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        if ($Result.Status -eq 405) { $Response.Headers['Allow'] = 'GET' }
        $bytes = [Text.Encoding]::UTF8.GetBytes($Result.Body)
        $Response.ContentLength64 = $bytes.Length
        $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } finally { $Response.Close() }
}

$validatedBase = ConvertTo-KBBaseUrl $ConfluenceBaseUrl
if ($LibraryOnly) { return }
$listener = New-Object Net.HttpListener
$secret = $null
$sessionKey = New-KBSession
try {
    if ($AuthMode -eq 'Token') { $secret = Read-Host 'Confluence personal bearer token (local process only)' -AsSecureString }
    $listener.Prefixes.Add("http://localhost:$Port/")
    try { $listener.Start() } catch {
        throw 'Cannot bind the local HttpListener. No administrator or policy changes are performed. Try another port or ask your VDI support team about the existing localhost listener policy; do not elevate this script.'
    }
    Write-Host "Local Confluence diagnostics: http://localhost:$Port/ (Ctrl+C to stop)"
    if (!$NoBrowser) { Start-Process "http://localhost:$Port/" }
    while ($listener.IsListening) {
        # Poll an async accept so Ctrl+C can interrupt and execute finally in PowerShell 5.1.
        $pending = $listener.BeginGetContext($null, $null)
        while (!$pending.AsyncWaitHandle.WaitOne(200)) { }
        try { $context = $listener.EndGetContext($pending) } finally { $pending.AsyncWaitHandle.Close() }
        try {
            $r = $context.Request
            $result = Invoke-KBRoute -Method $r.HttpMethod -Target $r.RawUrl -HostHeader $r.Headers['Host'] -Origin $r.Headers['Origin'] -FetchSite $r.Headers['Sec-Fetch-Site'] -Session $r.Headers['X-Knowledge-Session'] -ExpectedSession $sessionKey -Port $Port -BaseUrl $validatedBase -AuthMode $AuthMode -Token $secret -RemoteAddress $r.RemoteEndPoint.Address.ToString()
            Write-KBResponse $context.Response $result $sessionKey
        } catch { $context.Response.Abort() }
    }
} finally {
    $listener.Close()
    if ($null -ne $secret) { $secret.Dispose() }
    $secret = $null
    $sessionKey = $null
}
