@echo off
setlocal
title Turn Off Technocore Weekly Automation

echo.
echo Turning off the Technocore weekly Windows checks...
schtasks.exe /Delete /F /TN "Technocore Agent Dashboard - Daily Due Check" >nul 2>&1
schtasks.exe /Delete /F /TN "Technocore Agent Dashboard - Login Due Check" >nul 2>&1

if exist "%~dp0weekly_activity_config.json" (
  set "PYTHON_CMD=python"
  py -3.12 --version >nul 2>&1
  if not errorlevel 1 set "PYTHON_CMD=py -3.12"
  %PYTHON_CMD% -c "import json,pathlib,time; p=pathlib.Path(r'%~dp0weekly_activity_config.json'); d=json.loads(p.read_text(encoding='utf-8')); d['enabled']=False; d['disabled_at']=time.time(); p.write_text(json.dumps(d,indent=2),encoding='utf-8')" >nul 2>&1
)

echo.
echo Weekly automation is OFF.
echo You may close this window.
echo.
pause
endlocal
