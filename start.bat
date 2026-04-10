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

:: Validate venv: if activate.bat missing or venv Python is broken, rebuild
if not exist "venv\Scripts\activate.bat" goto :create_venv
call venv\Scripts\activate.bat
python --version >nul 2>&1
if %errorlevel%==0 goto :venv_ready
echo [INFO] Existing venv is broken, rebuilding...
call deactivate >nul 2>&1
rmdir /s /q venv

:create_venv
echo [INFO] Creating virtual environment...
python -m venv venv
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create virtual environment.
    pause
    exit /b 1
)
call venv\Scripts\activate.bat

:venv_ready

:: Install dependencies
echo [INFO] Checking dependencies...
python -m pip install -r requirements.txt -q

:: Create uploads folder
if not exist "uploads" mkdir uploads

:: Start server and open browser
echo.
echo [INFO] Starting server at http://127.0.0.1:5000
echo [INFO] Press Ctrl+C to stop.
echo.
start /b cmd /c "ping -n 3 127.0.0.1 >nul && start "" http://127.0.0.1:5000"
python app.py
