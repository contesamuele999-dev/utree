@echo off
REM ==========================================================
REM  uTree - PUBBLICAZIONE FORZATA
REM  Sovrascrive il remote (GitHub) con lo stato LOCALE.
REM  ATTENZIONE: i commit presenti SOLO su GitHub verranno persi
REM  (es. il commit "Add files via upload").
REM ==========================================================
cd /d "%~dp0"

echo.
echo ==========================================================
echo   ATTENZIONE: questo SOVRASCRIVE GitHub con il tuo locale.
echo   I commit presenti solo su GitHub verranno PERSI.
echo ==========================================================
echo.
set /p conf="Scrivi  SI  e premi invio per confermare: "
if /I not "%conf%"=="SI" goto :fine

set /p msg="Descrivi la modifica (invio per 'update'): "
if "%msg%"=="" set msg=update

git add -A
git commit -m "%msg%"
git push --force origin main

echo.
echo === Fatto! Il remote ora rispecchia il tuo locale. ===
echo Il sito si aggiorna in 1-2 minuti su:
echo https://contesamuele999-dev.github.io/arbora/
echo Controlla la tab Actions del repo per lo stato.
echo.
:fine
pause
