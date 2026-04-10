@echo off
chcp 65001 >nul
title Bionic PDF Reader

cd /d "%~dp0"

echo ========================================
echo   Bionic PDF Reader
echo ========================================
echo.

:: ---- Detect a working Python ----
set PY=
for %%C in (py python3 python) do (
    if not defined PY (
        %%C --version >nul 2>&1 && set PY=%%C
    )
)
if not defined PY (
    echo [ERROR] Python not found. Please install Python 3.8+ first.
    echo         https://www.python.org/downloads/
    pause
    exit /b 1
)
echo [INFO] Using: %PY%

:: ---- Validate existing venv ----
if not exist "venv\Scripts\python.exe" goto :need_venv
venv\Scripts\python.exe --version >nul 2>&1
if %errorlevel%==0 goto :venv_ready
echo [INFO] Existing venv is broken, removing...
rmdir /s /q venv

:need_venv
:: ---- Try creating venv ----
echo [INFO] Creating virtual environment...

:: Method 1: normal venv
%PY% -m venv venv >nul 2>&1
if not exist "venv\Scripts\python.exe" goto :try_no_pip
venv\Scripts\python.exe --version >nul 2>&1
if %errorlevel%==0 goto :venv_ready

:try_no_pip
:: Method 2: venv without pip (ensurepip might be missing)
if exist "venv" rmdir /s /q venv
echo [INFO] Retrying without pip bundling...
%PY% -m venv --without-pip venv >nul 2>&1
if not exist "venv\Scripts\python.exe" goto :skip_venv
venv\Scripts\python.exe --version >nul 2>&1
if %errorlevel% neq 0 goto :skip_venv

:: Bootstrap pip into the venv manually
echo [INFO] Bootstrapping pip...
venv\Scripts\python.exe -c "import ensurepip; ensurepip.bootstrap()" >nul 2>&1
if %errorlevel% neq 0 (
    :: ensurepip also missing, download get-pip.py
    echo [INFO] Downloading get-pip.py...
    venv\Scripts\python.exe -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', 'get-pip.py')"
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to download get-pip.py. Check your network.
        pause
        exit /b 1
    )
    venv\Scripts\python.exe get-pip.py -q
    del get-pip.py >nul 2>&1
)
goto :venv_ready

:skip_venv
:: Method 3: give up on venv, run with system Python directly
if exist "venv" rmdir /s /q venv
echo [WARN] Cannot create virtual environment, using system Python.
echo.
echo [INFO] Installing dependencies to system Python...
%PY% -m pip install -r requirements.txt -q
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)
goto :deps_done

:venv_ready
echo [INFO] Virtual environment OK.
echo [INFO] Installing dependencies...
venv\Scripts\python.exe -m pip install -r requirements.txt -q
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

:deps_done
:: Figure out which python to run the app with
if exist "venv\Scripts\python.exe" (
    set APP_PY=venv\Scripts\python.exe
) else (
    set APP_PY=%PY%
)

:: Create uploads folder
if not exist "uploads" mkdir uploads

:: Start server and open browser
echo.
echo [INFO] Starting server at http://127.0.0.1:5000
echo [INFO] Press Ctrl+C to stop.
echo.
start /b cmd /c "ping -n 3 127.0.0.1 >nul && start "" http://127.0.0.1:5000"
%APP_PY% app.py
