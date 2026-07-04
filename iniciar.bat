@echo off
setlocal
title Aclame
set "NODE=%USERPROFILE%\tools\node-v24.18.0-win-x64\node.exe"
if not exist "%NODE%" set "NODE=node"
cd /d "%~dp0"
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
echo ============================================
echo  Aclame - Escalas e Louvor da sua igreja
echo  http://localhost:3000
echo  Feche esta janela para encerrar o servidor.
echo ============================================
"%NODE%" server.js --seed
