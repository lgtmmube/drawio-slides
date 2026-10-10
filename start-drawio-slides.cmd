@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "DRAWIO_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined DRAWIO_NODE set "DRAWIO_NODE=%%N"
if not defined DRAWIO_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "DRAWIO_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined DRAWIO_NODE (
  echo Node.js was not found. Please install Node.js 18 or newer.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo The app is not built yet. Please follow the preparation steps in README.md.
  pause
  exit /b 1
)
echo Starting Drawio Slides. Keep this window open while you are editing.
echo Save your diagram before closing this window.
"%DRAWIO_NODE%" "scripts\serve.mjs" --open %*
if errorlevel 1 pause
endlocal
