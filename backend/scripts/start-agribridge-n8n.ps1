# =====================================================================
# AgriBridge: start ngrok + n8n (only if not already running)
# and register the Telegram webhook.
#   powershell -ExecutionPolicy Bypass -File backend\scripts\start-agribridge-n8n.ps1
# =====================================================================

# ---------- 1. Load env files (later files override earlier ones) ----------
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$candidates = @(
  (Join-Path $root ".env"),
  (Join-Path $root ".env.local"),
  (Join-Path $root "backend\.env"),
  (Join-Path $root "backend\.env.local")
)
foreach ($f in $candidates) {
  if (Test-Path $f) {
    Get-Content $f | ForEach-Object {
      if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*?)\s*$') {
        $val = $matches[2].Trim().TrimEnd(';').Trim().Trim('"').Trim("'")
        [Environment]::SetEnvironmentVariable($matches[1], $val, 'Process')
      }
    }
    Write-Host "Loaded $f"
  }
}

# ---------- 2. Settings ----------
$BotToken    = ([string]$env:TELEGRAM_BOT_TOKEN).Trim().TrimEnd(';').Trim('"', "'", ' ')
$Secret      = "agribridge_secret_4"   # must match EXPECTED_SECRET in "Verify & Normalize"
$Port        = 5678
$WebhookPath = "/webhook/agribridge-telegram"  # path only, no https://
# Command used to start n8n. Change it to match how n8n runs on your machine, e.g.:
#   "n8n start"
#   "cd /d C:\Users\saurabh && npx n8n start"
$N8nStart    = "n8n start"

if (-not $BotToken) {
  Write-Error "TELEGRAM_BOT_TOKEN is not set (add it to .env or backend\.env.local)"
  exit 1
}
try {
  $me = Invoke-RestMethod "https://api.telegram.org/bot$BotToken/getMe"
  Write-Host "Token OK, bot: @$($me.result.username)"
} catch {
  Write-Error "Bot token rejected by Telegram: $($_.ErrorDetails.Message)"
  exit 1
}

# ---------- helpers ----------
function Get-NgrokUrl {
  try {
    $t = Invoke-RestMethod "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 3
    $tun = $t.tunnels | Where-Object {
      $_.proto -eq "https" -and $_.config.addr -match ":$Port$"
    } | Select-Object -First 1
    return $tun.public_url
  } catch { return $null }
}
function Test-N8n {
  try {
    Invoke-WebRequest "http://localhost:$Port/healthz" -UseBasicParsing -TimeoutSec 3 | Out-Null
    return $true
  } catch { return $false }
}

# ---------- 3. ngrok: reuse if already tunnelling this port ----------
$url = Get-NgrokUrl
if ($url) {
  Write-Host "ngrok already running: $url"
} else {
  Stop-Process -Name ngrok -ErrorAction SilentlyContinue
  Start-Process ngrok -ArgumentList "http $Port" -WindowStyle Minimized
  for ($i = 0; $i -lt 30 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    $url = Get-NgrokUrl
  }
  if (-not $url) {
    Write-Error "ngrok did not start. Check that ngrok is installed and your authtoken is saved."
    exit 1
  }
  Write-Host "ngrok started: $url"
}

# ---------- 4. n8n: start only if it is not already answering ----------
if (Test-N8n) {
  Write-Host "n8n already running at http://localhost:$Port - not starting another copy"
} else {
  $env:WEBHOOK_URL = $url
  $env:N8N_DIAGNOSTICS_ENABLED = "false"
  Start-Process cmd -ArgumentList "/k $N8nStart"

  $up = $false
  for ($i = 0; $i -lt 90 -and -not $up; $i++) {
    Start-Sleep -Seconds 2
    $up = Test-N8n
  }
  if (-not $up) {
    Write-Error "n8n did not start in time"
    exit 1
  }
  Write-Host "n8n is running at http://localhost:$Port"
}

# ---------- 5. Register the Telegram webhook ----------
$full = $url.TrimEnd('/') + '/' + $WebhookPath.TrimStart('/')
Write-Host "Registering webhook: $full"

$body = @{
  url             = $full
  secret_token    = $Secret
  allowed_updates = @("message")
} | ConvertTo-Json

$ok = $false
for ($i = 1; $i -le 6 -and -not $ok; $i++) {
  try {
    $res = Invoke-RestMethod -Method Post `
           -Uri "https://api.telegram.org/bot$BotToken/setWebhook" `
           -ContentType "application/json" -Body $body
    Write-Host "setWebhook: $($res.description)"
    $ok = $true
  } catch {
    Write-Host "Attempt $i failed: $($_.ErrorDetails.Message)"
    Start-Sleep -Seconds 5
  }
}
if (-not $ok) {
  Write-Error "Could not register the webhook."
  exit 1
}

Write-Host "Done. Send a new message to your bot to test."