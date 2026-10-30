# =========================================================================
# Snowball · servidor local
# -------------------------------------------------------------------------
# Sirve la carpeta del proyecto por HTTP para poder probar el login de Google
# (que no funciona con file://). No instala nada: usa .NET del propio Windows.
#
#   powershell -ExecutionPolicy Bypass -File .\serve.ps1
#   powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8080
#
# Detener con Ctrl+C.
# =========================================================================
param(
    [int]$Port = 5500,
    [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\', '/')
$prefix = "http://localhost:$Port/"
$origin = "http://localhost:$Port"

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.map'  = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.webp' = 'image/webp'
    '.avif' = 'image/avif'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2' = 'font/woff2'
    '.mp4'  = 'video/mp4'
    '.webm' = 'video/webm'
    '.m3u8' = 'application/vnd.apple.mpegurl'
    '.ts'   = 'video/mp2t'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/plain; charset=utf-8'
}

function Send-Body {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [int]$Status,
        [string]$ContentType,
        [byte[]]$Bytes
    )
    $Response.StatusCode = $Status
    $Response.ContentType = $ContentType
    $Response.ContentLength64 = $Bytes.Length
    $Response.Headers['Cache-Control'] = 'no-store'
    $Response.Headers['X-Content-Type-Options'] = 'nosniff'
    $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $Response.OutputStream.Close()
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "  No se pudo abrir $prefix" -ForegroundColor Red
    Write-Host "  Prueba con otro puerto:  -Port 8080" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  SNOWBALL" -ForegroundColor White
Write-Host "  $origin" -ForegroundColor Green
Write-Host ""
Write-Host "  Sirviendo: $Root"
Write-Host "  Recuerda añadir $origin/** a Supabase → Authentication → Redirect URLs"
Write-Host "  Ctrl+C para detener."
Write-Host ""

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        try {
            $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
            if ([string]::IsNullOrWhiteSpace($path) -or $path -eq '/') {
                $path = '/index.html'
            }

            $relative = $path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            $full = [System.IO.Path]::GetFullPath((Join-Path $Root $relative))

            # Impide salir de la carpeta del proyecto (..\..\)
            if (-not ($full -eq $Root -or $full.StartsWith($Root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase))) {
                Send-Body -Response $res -Status 403 -ContentType 'text/plain; charset=utf-8' `
                    -Bytes ([System.Text.Encoding]::UTF8.GetBytes('403 Prohibido'))
                continue
            }

            if (Test-Path -LiteralPath $full -PathType Container) {
                $full = Join-Path $full 'index.html'
            }

            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                Send-Body -Response $res -Status 404 -ContentType 'text/plain; charset=utf-8' `
                    -Bytes ([System.Text.Encoding]::UTF8.GetBytes('404 No encontrado'))
                continue
            }

            $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
            $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }

            $bytes = [System.IO.File]::ReadAllBytes($full)
            Send-Body -Response $res -Status 200 -ContentType $type -Bytes $bytes
        } catch {
            try {
                Send-Body -Response $res -Status 500 -ContentType 'text/plain; charset=utf-8' `
                    -Bytes ([System.Text.Encoding]::UTF8.GetBytes('500 Error interno'))
            } catch { }
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Host ""
    Write-Host "  Servidor detenido." -ForegroundColor Yellow
}
