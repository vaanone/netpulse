@echo off
setlocal
REM ============================================================
REM  Netpulse local launcher (Windows)
REM
REM  Usage:
REM    start-netpulse.bat           production server (builds first if needed)
REM    start-netpulse.bat dev       development server (hot reload)
REM    start-netpulse.bat build     build the production bundle only
REM
REM  Login: admin / Hipoint@123  (change it after first login)
REM ============================================================
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo [netpulse] Bun is not installed. Install it from https://bun.sh first,
  echo [netpulse] then reopen this window and retry.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [netpulse] Installing dependencies ^(first run only^)...
  call bun install
  if errorlevel 1 ( echo [netpulse] bun install failed. & pause & exit /b 1 )
)

if "%1"=="dev" (
  echo [netpulse] Starting DEVELOPMENT server on http://localhost:3000 ...
  call bun run dev
  exit /b 0
)

if "%1"=="build" (
  echo [netpulse] Building production bundle...
  call bun run build
  if errorlevel 1 ( echo [netpulse] build failed. & pause & exit /b 1 )
  echo [netpulse] Build complete.
  pause
  exit /b 0
)

if not exist ".next\BUILD_ID" (
  echo [netpulse] No production build found - building once ^(first run only^)...
  call bun run build
  if errorlevel 1 ( echo [netpulse] build failed. & pause & exit /b 1 )
)

echo [netpulse] Starting PRODUCTION server on http://localhost:3000 ...
echo [netpulse] Press Ctrl+C to stop.
call bun run start
