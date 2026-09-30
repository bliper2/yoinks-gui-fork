@echo off
setlocal
cd /d "%~dp0"

if exist "node_modules\electron\dist\electron.exe" goto :run

echo Installing dependencies...
call npm install
if errorlevel 1 goto :error

if not exist "node_modules\electron\dist\electron.exe" (
    echo Electron binary missing, running installer...
    node node_modules\electron\install.js
)

if not exist "node_modules\electron\dist\electron.exe" goto :error

:run
start "" "%~dp0node_modules\electron\dist\electron.exe" .
exit /b 0

:error
echo.
echo Failed to prepare Electron. Delete node_modules and run start.bat again.
pause
exit /b 1
