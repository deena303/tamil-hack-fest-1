@echo off
:: TamilVault AI — Start Backend (Windows)
:: Run this from the project root.

setlocal

set "ROOT=%~dp0"
set "VENV=%ROOT%.venv\Scripts"
set "BACKEND=%ROOT%backend"

if not exist "%VENV%\python.exe" (
    echo [ERROR] Virtual environment not found at .venv\
    echo         Create it with:  py -m venv .venv
    echo         Then install:    .venv\Scripts\pip install -r backend\requirements.txt
    pause
    exit /b 1
)

echo [INFO] Activating virtual environment...
call "%VENV%\activate.bat"

echo [INFO] Checking Tesseract...
where tesseract >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files\Tesseract-OCR\tesseract.exe" (
        echo [INFO] Tesseract found at: C:\Program Files\Tesseract-OCR\tesseract.exe
    ) else (
        echo [WARN] tesseract.exe not found on PATH.
        echo        The backend will still start but OCR will fail.
        echo        Install from: https://github.com/UB-Mannheim/tesseract/wiki
    )
) else (
    for /f "delims=" %%i in ('where tesseract') do echo [INFO] Tesseract found: %%i
)

echo [INFO] Starting FastAPI backend on http://localhost:8000 ...
echo        API docs: http://localhost:8000/docs
echo        Press Ctrl+C to stop.
echo.
cd /d "%BACKEND%"
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

endlocal
