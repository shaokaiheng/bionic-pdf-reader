@echo off
chcp 65001 >nul
title Bionic PDF Reader

cd /d "%~dp0"

echo ========================================
echo   Bionic PDF Reader
echo ========================================
echo.

:: Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.8+ first.
    echo         https://www.python.org/downloads/
    pause
    exit /b 1
)

:: Create venv if not exists
if not exist "venv\Scripts\activate.bat" (
    echo [INFO] Creating virtual environment...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

:: Activate venv
call venv\Scripts\activate.bat

:: Install dependencies
echo [INFO] Checking dependencies...
pip install -r requirements.txt -q

:: Create uploads folder
if not exist "uploads" mkdir uploads

:: Start server and open browser
echo.
echo [INFO] Starting server at http://127.0.0.1:5000
echo [INFO] Press Ctrl+C to stop.
echo.
start "" http://127.0.0.1:5000
python app.py
