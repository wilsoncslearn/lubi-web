@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto neednode
node -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)"
if errorlevel 1 goto neednode
node scripts\check-install.mjs
if errorlevel 1 (
  call npm ci
  if errorlevel 1 goto failed
)
call npm run setup
if errorlevel 1 goto failed
node scripts\show-access.mjs
call npm run start -- --build --open
if errorlevel 1 goto failed
exit /b 0
:neednode
echo 请先安装 Node.js 24 或更新版本。
pause
exit /b 1
:failed
echo 启动未完成。请保留以上报错；不会覆盖旧数据库。
pause
exit /b 1
