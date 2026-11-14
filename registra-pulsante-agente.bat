@echo off
REM ====================================================
REM  uTree - abilita il pulsante "Giro locale" della scheda Knowledge
REM  Da lanciare UNA volta (doppio click). Registra per il solo utente
REM  corrente il link "utree-agente:" che avvia avvia-agente-locale.bat.
REM  Il link non passa nessun argomento al .bat: un sito non puo' fargli
REM  eseguire altro. Per toglierlo: registra-pulsante-agente.bat rimuovi
REM ====================================================
chcp 65001 >nul
set "CHIAVE=HKCU\Software\Classes\utree-agente"

if /i "%~1"=="rimuovi" (
    reg delete "%CHIAVE%" /f >nul 2>&1
    echo Pulsante "Giro locale" disattivato.
    pause
    exit /b 0
)

reg add "%CHIAVE%" /ve /d "URL:uTree agente locale" /f >nul
reg add "%CHIAVE%" /v "URL Protocol" /d "" /f >nul
reg add "%CHIAVE%\shell\open\command" /ve /d "\"%~dp0avvia-agente-locale.bat\"" /f >nul
echo.
echo Fatto: in uTree, scheda Knowledge, il pulsante "Giro locale" ora avvia l'agente su questo PC.
echo La prima volta il browser chiede se aprire il link: conferma (puoi spuntare "ricorda").
echo.
pause
