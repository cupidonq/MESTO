@echo off
rem Двойной щелчок: запускает MESTO на этом компьютере. Docker не нужен.
rem Если на компьютере нет Node.js 22+, он скачивается автоматически (портативно, без установки и прав администратора).
chcp 65001 >nul
title MESTO
cd /d "%~dp0"

rem 1. подходящий Node.js уже есть в системе?
set NODEMAJOR=0
where node >nul 2>nul
if not errorlevel 1 for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% GEQ 22 goto run

rem 2. иначе — свой портативный Node.js рядом с программой
if not exist "local\runtime\node\node.exe" (
  echo.
  echo   На этом компьютере нет Node.js 22 или новее. Скачиваю портативную версию с nodejs.org...
  powershell -NoProfile -ExecutionPolicy Bypass -File "local\bootstrap.ps1"
  if errorlevel 1 goto fail
)
set "PATH=%~dp0local\runtime\node;%PATH%"

:run
node local\launcher.mjs
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
