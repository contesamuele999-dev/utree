@echo off
REM ====================================================
REM  uTree - aggiornamento rapido su GitHub Pages
REM  Doppio click per pushare le modifiche e ripubblicare
REM ====================================================
cd /d "%~dp0"

echo.
echo === Aggiornamento uTree ===
echo.

set /p msg="Descrivi la modifica (invio per 'update'): "
if "%msg%"=="" set msg=update

git add -A
git commit -m "%msg%"
git push

echo.
echo === Push completato! ===
echo Il sito si aggiorna in 1-2 minuti su:
echo https://contesamuele999-dev.github.io/arbora/
echo Controlla la tab Actions del repo per lo stato.
echo.
pause
