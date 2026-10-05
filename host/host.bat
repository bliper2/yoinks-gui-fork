@echo off
rem Starts the Yoinks helper for the browser extension (Node.js is needed).
rem Browsers start this with their own environment, which can lack Node in PATH,
rem so look in the usual install folders too. Problems go to %USERPROFILE%\.yoinks\helper.log
setlocal
set "LOG=%USERPROFILE%\.yoinks\helper.log"
if not exist "%USERPROFILE%\.yoinks" mkdir "%USERPROFILE%\.yoinks" >nul 2>nul
set "NODE_EXE="
for %%N in (node.exe) do set "NODE_EXE=%%~$PATH:N"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE_EXE (
  echo %date% %time% host.bat: Node.js not found. Install it from nodejs.org, then restart the browser.>>"%LOG%"
  exit /b 1
)
echo %date% %time% host.bat: starting with %NODE_EXE%>>"%LOG%"
"%NODE_EXE%" "%~dp0host.js" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" echo %date% %time% host.bat: node exited with %CODE%>>"%LOG%"
exit /b %CODE%
