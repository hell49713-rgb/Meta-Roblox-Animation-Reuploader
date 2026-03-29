@echo off
cd /d "%~dp0"

if not exist "node_modules" (
    echo ========================================
    echo   META - First Time Setup
    echo ========================================
    echo.
    echo Installing dependencies from resources\dependencies.txt...
    echo This will take 2-3 minutes.
    echo.
    
    setlocal enabledelayedexpansion
    set DEPS=
    for /f "usebackq tokens=*" %%i in ("resources\dependencies.txt") do (
        set DEPS=!DEPS! %%i
    )
    
    call npm install !DEPS! --no-fund --no-audit
    
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: Installation failed!
        echo Make sure Node.js is installed from https://nodejs.org/
        pause
        exit /b 1
    )
    echo.
    echo Installation complete! Starting META...
    timeout /t 2 /nobreak >nul
)

wscript.exe "%~dp0resources\launch_meta.vbs"
