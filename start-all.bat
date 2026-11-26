@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================
echo   KOMA - Uruchamianie calego systemu
echo ==========================================
echo.

echo [1/5] Zatrzymywanie istniejacych procesow Ollama...
taskkill /F /IM ollama.exe >nul 2>&1
taskkill /F /IM "ollama app.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/5] Uruchamianie serwera Ollama...
start "Ollama Server" cmd /k "ollama serve"
timeout /t 3 /nobreak >nul

echo [3/5] Budowanie frontendu (npm run build)...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [BLAD] Nie udalo sie zbudowac frontendu!
    pause
    exit /b %ERRORLEVEL%
)

echo [4/5] Uruchamianie backendu KOMA...
start "KOMA Backend" cmd /k "cd /d "%~dp0" && npm start"
timeout /t 2 /nobreak >nul

echo [5/5] Uruchamianie bota Discord...
start "KOMA Discord Bot" cmd /k "cd /d "%~dp0discord-bot" && npm start"

echo.
echo Wszystko uruchomione! Otwieranie http://localhost:3000 ...
start http://localhost:3000
echo.
pause
