<#
  Скачивает портативный Node.js 22 (LTS) в local\runtime\node, если на компьютере нет подходящего.
  Ничего не устанавливает в систему и не требует прав администратора.
  Файл берётся только с https://nodejs.org и проверяется по контрольной сумме SHA-256 из официального списка.
#>
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # без этого Invoke-WebRequest в Windows PowerShell 5.1 качает в разы медленнее
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$runtime = Join-Path $PSScriptRoot 'runtime'
$target  = Join-Path $runtime 'node'
if (Test-Path -LiteralPath (Join-Path $target 'node.exe')) { exit 0 }

$base = 'https://nodejs.org/dist/latest-v22.x/'
try {
  $sums = (Invoke-WebRequest -Uri ($base + 'SHASUMS256.txt') -UseBasicParsing).Content
  $m = [regex]::Match($sums, '(?m)^([0-9a-f]{64})\s+(node-v22\.[0-9.]+-win-x64\.zip)\s*$')
  if (-not $m.Success) { throw 'в списке nodejs.org нет сборки для Windows x64' }
  $hash = $m.Groups[1].Value
  $file = $m.Groups[2].Value

  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $zip = Join-Path $runtime $file
  $tmp = Join-Path $runtime '_unpack'
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host "  Скачиваю Node.js ($file, около 30 МБ)..."
  Invoke-WebRequest -Uri ($base + $file) -OutFile $zip -UseBasicParsing

  $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $hash) {
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    throw 'контрольная сумма скачанного файла не совпала — файл удалён'
  }

  Write-Host '  Распаковываю...'
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $inner = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
  if (-not $inner -or -not (Test-Path -LiteralPath (Join-Path $inner.FullName 'node.exe'))) { throw 'в архиве нет node.exe' }
  Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $inner.FullName -Destination $target
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
  Write-Host '  Node.js готов.'
  exit 0
} catch {
  Write-Host ("  [X] Не удалось подготовить Node.js: " + $_.Exception.Message) -ForegroundColor Red
  Write-Host '      Проверьте интернет или установите Node.js 22 вручную: https://nodejs.org'
  exit 1
}
