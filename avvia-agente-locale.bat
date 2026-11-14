@echo off
REM ====================================================
REM  uTree - agente notizie con il modello LOCALE (Ollama)
REM  Doppio click (o pulsante "Giro locale" in uTree):
REM  accende Ollama se serve, la prima volta scarica il modello,
REM  poi cerca le novita' in tutte le knowledge base.
REM  Il ragionamento lo fa questo PC: nessun testo va a Google.
REM  (Gli argomenti passati al .bat vengono ignorati di proposito.)
REM ====================================================
chcp 65001 >nul
cd /d "%~dp0"
setlocal

set "MODELLO=llama3.1:8b"
for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"OLLAMA_MODEL=" .env 2^>nul') do set "MODELLO=%%b"
set "OLLAMA_APP=%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"

echo.
echo === Agente notizie - modello locale (%MODELLO%) ===
echo.

ollama list >nul 2>&1
if not errorlevel 1 goto pronto
echo Accendo Ollama...
if exist "%OLLAMA_APP%" (start "" "%OLLAMA_APP%") else (start "Ollama" /min ollama serve)
for /l %%i in (1,1,40) do (
    timeout /t 1 /nobreak >nul
    ollama list >nul 2>&1 && goto pronto
)
echo.
echo Ollama non risponde. Aprilo dal menu Start e riprova.
pause
exit /b 1

:pronto
ollama list | findstr /i /c:"%MODELLO%" >nul
if errorlevel 1 (
    echo Prima volta: scarico il modello %MODELLO% - circa 5 GB, attendi...
    ollama pull %MODELLO%
    if errorlevel 1 (
        echo Download non riuscito.
        pause
        exit /b 1
    )
)

echo Cerco le novita' nelle knowledge base: puo' richiedere qualche minuto...
echo.
node scripts\agente-notizie.mjs --locale
echo.
if errorlevel 1 (echo Qualcosa e' andato storto: guarda agente-notizie.log) else (echo Fatto. Le proposte sono in uTree, scheda Knowledge - Da valutare.)
echo.
pause
