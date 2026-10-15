@echo off
:: TamilVault AI — Start Frontend (Windows)
:: Run this from the project root.

setlocal

set "ROOT=%~dp0"
set "FRONTEND=%ROOT%frontend"

if not exist "%FRONTEND%\node_modules" (
    echo [INFO] node_modules not found — running npm install...
    cd /d "%FRONTEND%"
    npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed. Make sure Node.js is installed.
        pause
        exit /b 1
    )
)

echo [INFO] Starting Vite dev server...
echo        Frontend: http://localhost:5173
echo        Press Ctrl+C to stop.
echo.
cd /d "%FRONTEND%"
npm run dev

endlocal
