@echo off
rem Bezobidnyi rozygrysh: kartinka na ves ekran i zvuk odin raz. Nichego ne ustanavlivaet.
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0prank.ps1"
