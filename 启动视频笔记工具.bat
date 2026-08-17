@echo off
setlocal
chcp 65001 >nul

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js。请先安装 Node.js 后再运行。
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 npm。请确认 Node.js 安装完整。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [准备] 正在安装项目依赖，第一次运行会稍慢...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败。
    pause
    exit /b 1
  )
)

echo [启动] 视频笔记工具正在运行...
echo [地址] http://127.0.0.1:5173/
echo.
echo 这个窗口不要关闭；关闭后网站和 Markdown 里的本地图片链接会失效。
echo.

start "" "http://127.0.0.1:5173/"
call npm run dev

pause
