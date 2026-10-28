<#
.SYNOPSIS
    Legado-E Book Source Debug Tool - WebSocket Version
.DESCRIPTION
    Debug book sources via WebSocket connection, supports:
    - Debug Explore (explore) - Format: CategoryName::URL
    - Debug Info (info) - Absolute URL
    - Debug TOC (toc) - URL with ++ prefix
    - Debug Content (content) - URL with -- prefix
    - Search (search) - Search keyword

.PARAMETER Mode
    Debug mode: explore, info, toc, content, search

.PARAMETER BookSourceUrl
    Book source URL (e.g., https://russtrat.ru)

.PARAMETER Url
    URL or keyword to debug

.PARAMETER ServerHost
    Legado-E server IP (default: 192.168.31.163)

.PARAMETER WsPort
    WebSocket port (default: 1123)

.PARAMETER HttpPort
    HTTP API port (default: 1122)

.PARAMETER SkipSourceCheck
    Skip book source existence check

.EXAMPLE
    # Debug info page
    .\book_source_debug_tool.ps1 -Mode info -BookSourceUrl "https://russtrat.ru" -Url "https://russtrat.ru/analytics/1782826463-13375"

.EXAMPLE
    # Debug TOC page
    .\book_source_debug_tool.ps1 -Mode toc -BookSourceUrl "https://russtrat.ru" -Url "https://russtrat.ru/analytics/1782826463-13375"

.EXAMPLE
    # Debug content page
    .\book_source_debug_tool.ps1 -Mode content -BookSourceUrl "https://russtrat.ru" -Url "https://russtrat.ru/analytics/1782826463-13375/20940996"

.EXAMPLE
    # Debug explore (discover) page
    .\book_source_debug_tool.ps1 -Mode explore -BookSourceUrl "https://russtrat.ru" -Url "Analytics::https://russtrat.ru/analytics"

.EXAMPLE
    # Search
    .\book_source_debug_tool.ps1 -Mode search -BookSourceUrl "https://russtrat.ru" -Url "keyword"
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("explore", "info", "toc", "content", "search")]
    [string]$Mode,

    [Parameter(Mandatory=$true)]
    [string]$BookSourceUrl,

    [Parameter(Mandatory=$true)]
    [string]$Url,

    [string]$ServerHost = "192.168.31.73",

    [int]$WsPort = 1123,

    [int]$HttpPort = 1122,

    [switch]$SkipSourceCheck
)

$ErrorActionPreference = "Stop"

# Mode to prefix mapping
function Get-KeyPrefix {
    param([string]$Mode)
    switch ($Mode) {
        "explore" { return "" }
        "info"     { return "" }
        "toc"      { return "++" }
        "content"  { return "--" }
        "search"   { return "" }
        default    { return "" }
    }
}

# Mode name mapping
function Get-ModeName {
    param([string]$Mode)
    switch ($Mode) {
        "explore" { return "Explore (Discover)" }
        "info"     { return "Info Page" }
        "toc"      { return "TOC Page" }
        "content"  { return "Content Page" }
        "search"   { return "Search" }
        default    { return $Mode }
    }
}

# Build debug message
function Build-DebugMessage {
    param(
        [string]$Tag,
        [string]$Key
    )

    $msg = @{
        tag = $Tag
        key = $Key
    } | ConvertTo-Json -Compress

    return $msg
}

# WebSocket debug using synchronous methods
function Invoke-BookSourceDebug {
    param(
        [string]$BookSourceUrl,
        [string]$DebugUrl,
        [string]$Mode
    )

    $prefix = Get-KeyPrefix -Mode $Mode
    $key = $prefix + $DebugUrl
    $modeName = Get-ModeName -Mode $Mode

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " Legado-E Book Source Debug Tool" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[INFO] Debug Mode: $modeName" -ForegroundColor Yellow
    Write-Host "[INFO] BookSource URL: $BookSourceUrl" -ForegroundColor Yellow
    Write-Host "[INFO] Debug URL: $DebugUrl" -ForegroundColor Yellow
    Write-Host "[INFO] WebSocket: ws://${ServerHost}:${WsPort}/bookSourceDebug" -ForegroundColor Yellow
    Write-Host ""

    # Check if book source exists (optional)
    Write-Host "[1/4] Checking book source..." -ForegroundColor Gray
    if (-not $SkipSourceCheck) {
        $checkUrl = "http://${ServerHost}:${HttpPort}/getBookSource?url=$([uri]::EscapeDataString($BookSourceUrl))"
        try {
            $response = Invoke-RestMethod -Uri $checkUrl -TimeoutSec 10
            if (-not $response.isSuccess) {
                Write-Host "[-] Book source not found: $($response.errorMsg)" -ForegroundColor Red
                Write-Host ""
                Write-Host "[HINT] Please save the book source first, or check if the URL is correct" -ForegroundColor Yellow
                return
            }
            Write-Host "[+] Book source found: $($response.data.bookSourceName)" -ForegroundColor Green
        } catch {
            Write-Host "[-] Cannot connect to Legado-E API: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host ""
            Write-Host "[HINT] Use -SkipSourceCheck to skip this check" -ForegroundColor Yellow
            Write-Host "[HINT] Or make sure Legado-E Web Service is enabled" -ForegroundColor Yellow
            Write-Host "[HINT] HTTP API Port: $HttpPort" -ForegroundColor Yellow
            Write-Host "[HINT] WebSocket Port: $WsPort" -ForegroundColor Yellow
            return
        }
    } else {
        Write-Host "[*] Skipping source check (use -SkipSourceCheck)" -ForegroundColor Cyan
    }

    # Build WebSocket URL
    $wsUrl = "ws://${ServerHost}:${WsPort}/bookSourceDebug"
    Write-Host ""
    Write-Host "[2/4] Connecting to WebSocket..." -ForegroundColor Gray

    $endPoint = [System.Net.WebSockets.ClientWebSocket]::new()
    $ct = [Threading.CancellationToken]::None

    # Use synchronous Wait with timeout
    $connectTask = $endPoint.ConnectAsync($wsUrl, $ct)
    $connected = $connectTask.Wait(8000)

    if (-not $connected -or $endPoint.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
        Write-Host "[-] WebSocket connection failed or timeout" -ForegroundColor Red
        Write-Host "    State: $($endPoint.State)" -ForegroundColor Red
        Write-Host ""
        Write-Host "[HINT] WebSocket port $WsPort may not be enabled" -ForegroundColor Yellow
        Write-Host "[HINT] Enable 'Web Service' in Legado-E settings" -ForegroundColor Yellow
        Write-Host "[HINT] Keep phone awake during debugging" -ForegroundColor Yellow
        if ($endPoint.State -ne [System.Net.WebSockets.WebSocketState]::Closed) {
            $endPoint.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $ct).Wait(1000)
        }
        return
    }

    Write-Host "[+] WebSocket connected" -ForegroundColor Green

    # Send debug message
    Write-Host ""
    Write-Host "[3/4] Sending debug request..." -ForegroundColor Gray

    $debugMsg = Build-DebugMessage -Tag $BookSourceUrl -Key $key
    $msgBytes = [Text.Encoding]::UTF8.GetBytes($debugMsg)
    $msgSegment = [ArraySegment[byte]]::new($msgBytes)

    try {
        $sendTask = $endPoint.SendAsync($msgSegment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct)
        $sent = $sendTask.Wait(5000)

        if (-not $sent) {
            Write-Host "[-] Send message timeout" -ForegroundColor Red
            $endPoint.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $ct).Wait(1000)
            return
        }

        Write-Host "[+] Debug request sent" -ForegroundColor Green
        Write-Host "[*] Waiting for response..." -ForegroundColor Cyan

    } catch {
        Write-Host "[-] Send message failed: $($_.Exception.Message)" -ForegroundColor Red
        $endPoint.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $ct).Wait(1000)
        return
    }

    # Receive response with timeout
    Write-Host ""
    Write-Host "[4/4] Receiving debug results:" -ForegroundColor Gray
    Write-Host "----------------------------------------" -ForegroundColor Gray

    $buffer = [byte[]]::new(16384)
    $messages = @()
    $receiveTimeout = 120  # seconds
    $startTime = [DateTime]::Now

    while ($endPoint.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        # Check timeout
        if (([DateTime]::Now - $startTime).TotalSeconds -gt $receiveTimeout) {
            Write-Host ""
            Write-Host "[*] Receive timeout ($receiveTimeout seconds)" -ForegroundColor Yellow
            break
        }

        $seg = [ArraySegment[byte]]::new($buffer)
        $receiveTask = $endPoint.ReceiveAsync($seg, $ct)

        # Wait for receive with shorter timeout, then check again
        $received = $receiveTask.Wait(5000)

        if (-not $received) {
            continue
        }

        $result = $receiveTask.Result

        if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
            break
        }

        $msg = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)

        # Skip ping messages
        if ($msg -eq "ping") {
            continue
        }

        $messages += $msg

        # Print the message
        Write-Host $msg

        # Check if this looks like a completion message
        if ($msg -match "\u300A|\u300B|End|end|\u7ED3\u675F|Complete|complete" -or $msg.Length -gt 10000) {
            # Give a moment for any final messages
            Start-Sleep -Milliseconds 300
        }
    }

    # Close connection
    if ($endPoint.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        $endPoint.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Debug Complete", $ct).Wait(1000)
    }

    # Show summary
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan

    if ($messages.Count -eq 0) {
        Write-Host "[-] No response received" -ForegroundColor Red
    } else {
        $lastMsg = $messages[-1]

        if ($lastMsg -match "Complete|complete|End|end|\u7ED3\u675F|\u300A\u300B|\u300E\u300F") {
            Write-Host "[+] Debug Complete!" -ForegroundColor Green
        } elseif ($lastMsg -match "error|Error|\u9519\u8BEF|failed|Failed") {
            Write-Host "[-] Debug encountered errors" -ForegroundColor Red
        } else {
            Write-Host "[*] Debug finished (received $($messages.Count) messages)" -ForegroundColor Yellow
        }
    }

    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

# Execute debug
Invoke-BookSourceDebug -BookSourceUrl $BookSourceUrl -DebugUrl $Url -Mode $Mode
