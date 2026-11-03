// Electron 主进程
//
// 思路：Electron 只负责「把 frontend/dist 装进一个桌面窗口」。
// 为了让 Vue Router 的 history 模式、刷新、深链接都和浏览器里完全一致，
// 这里不用 file:// 直接打开 index.html，而是起一个只监听 127.0.0.1 的
// 极简静态服务（端口随机），窗口打开 http://127.0.0.1:<port>/。
// 后端 API 仍由构建时写入的 VITE_API_BASE 指向你的后端域名，与本机服务无关。

const { app, BrowserWindow, shell, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 开发时：仓库里的 frontend/dist
// 打包后：electron-builder 把 frontend/dist 复制到 resources/dist
const DIST_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'dist')
  : path.join(__dirname, '..', '..', 'frontend', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

let server = null;
let mainWindow = null;

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  const indexFile = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(indexFile)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端尚未构建：请在 frontend 目录执行 npm install && npm run build\n');
    return;
  }

  // 无扩展名的路径（/、/guide、/admin）一律回退 index.html，交给 Vue Router
  if (pathname === '/' || !path.extname(pathname)) {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    fs.createReadStream(indexFile).pipe(res);
    return;
  }

  const resolved = path.resolve(DIST_DIR, `.${pathname}`);
  const rel = path.relative(DIST_DIR, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(resolved)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
  });
  fs.createReadStream(resolved).pipe(res);
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer(serveStatic);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function createWindow() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    dialog.showErrorBox(
      '找不到前端文件',
      `未找到 ${DIST_DIR}/index.html。\n\n请先在 frontend 目录执行：\nnpm install && npm run build`
    );
    app.quit();
    return;
  }

  const port = await startLocalServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Live Dashboard',
    backgroundColor: '#fff6f9',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 外部链接（MacroDroid、GitHub 等）交给系统浏览器，不在窗口里开新页
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  if (server) server.close();
});
