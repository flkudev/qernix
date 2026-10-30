@echo off
setlocal
set "URL=http://127.0.0.1:3000"
set "PROFILE=%TEMP%\qernix-autoplay"
set "FLAGS=--autoplay-policy=no-user-gesture-required --user-data-dir=%PROFILE% --no-first-run --no-default-browser-check --window-size=1280,860 --app=%URL%"

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" %FLAGS%
  exit /b
)

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" %FLAGS%
  exit /b
)

set "BRAVE=%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
if exist "%BRAVE%" (
  start "" "%BRAVE%" %FLAGS%
  exit /b
)

echo No Chromium browser found, opening the default browser instead.
start "" "%URL%"
