const { app, BrowserWindow, dialog, shell } = require("electron");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PORT = Number(process.env.PORT || 8787);
const APP_URL = `http://127.0.0.1:${PORT}/`;
let mainWindow = null;

function getAppRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "app") : path.resolve(__dirname, "..");
}

function requestHealth() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${PORT}/api/health`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(800, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await requestHealth()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

async function startServerIfNeeded() {
  if (await requestHealth()) {
    return;
  }

  const appRoot = getAppRoot();
  const exeDir = app.isPackaged ? path.dirname(process.execPath) : appRoot;
  const externalEnvPath = path.join(exeDir, ".env");
  const bundledEnvPath = path.join(appRoot, ".env");

  process.env.LEARNING_CARD_DATA_DIR = path.join(app.getPath("userData"), "generated");
  process.env.LEARNING_CARD_ENV_PATH = require("node:fs").existsSync(externalEnvPath)
    ? externalEnvPath
    : bundledEnvPath;

  await import(pathToFileURL(path.join(appRoot, "server", "index.js")).href);

  if (!(await waitForServer())) {
    throw new Error("本地服务启动超时。");
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "视频笔记工具",
    backgroundColor: "#f7faff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadURL(APP_URL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  try {
    await startServerIfNeeded();
    createWindow();
  } catch (error) {
    dialog.showErrorBox("视频笔记工具启动失败", error.message || String(error));
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
