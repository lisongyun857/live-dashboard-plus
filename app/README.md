# 软件端 · 打包成 App（Android APK / iOS / Windows）

本项目分为三块：**前端**（`frontend/`，Vue 3 构建出的纯静态文件）、**后端**（`backend/`，独立 Node.js API 域名）、**软件端**（`app/`，本文档所在的打包工程）。

前端产物是纯静态文件，所以可以装进手机，也可以装成 Windows 桌面程序：

| 方案 | 平台 | 成本 | 体验 | 适合 |
|---|---|---|---|---|
| **A. PWA 添加到主屏幕** | Android / iOS | 0（什么都不用做） | 图标在主屏、全屏打开、无商店 | 只是自己用、不想折腾签名 |
| **B. Capacitor 内嵌 dist（推荐做 APK）** | Android / iOS | 中，需要 Android Studio / Xcode | 真 APK / iOS App，可分发 | 想装成 App、发给别人 |
| **C. Capacitor + `server.url` 指向线上前端** | Android / iOS | 与 B 相同 | App 外壳，内容随时更新不用重新发版 | 频繁改前端、不想每次重新打包 |
| **D. Electron 打包 exe** | Windows | 低，只需要 Node.js | 独立窗口、安装包 / 便携版 | 想在电脑上双击就用 |

> 三块目录各管各的：**打包工具只放在 `app/`**，`frontend/` 只负责出 `dist`，`backend/` 只负责 API。Capacitor 工程（`app/android`、`app/ios`）和 Electron 工程（`app/electron`）都在 `app/` 里，不会污染前端源码。

---

## 1. 打包前必须做的两件事（三个平台通用）

App 内没有「同源」概念，前端必须知道后端 API 的绝对地址。

**① 填 API 域名**（[frontend/.env.production](../frontend/.env.production)）：

```ini
VITE_API_BASE=https://api.example.com
```

必须是 `https://`：Android 9+ 默认禁止明文 HTTP，iOS 的 ATS 也默认拦截 HTTP。

**② 重新构建**：

```bash
cd frontend
npm install
npm run build     # 产物 frontend/dist，后面 Cap / Electron 都用这个目录
```

**跨域**：后端已返回 `Access-Control-Allow-Origin: *`，Capacitor 的 WebView 源（Android `https://localhost`、iOS `capacitor://localhost`）和 Electron 的 `http://127.0.0.1:<随机端口>` 都能直接访问，**不用改 CORS**。以后若把 CORS 收紧成白名单，记得把这几个源加进去。

---

## 2. Android APK（Capacitor）

### 2.1 环境准备

- **JDK 17**（Capacitor 7 要求）
- **Android Studio**（含 Android SDK、Platform Tools）
- Node.js 18+

装完 Android Studio 后，在它的 SDK Manager 里装一个 API 34+ 的平台和一个模拟器（或直接连数据线用真机）。

### 2.2 初始化 Capacitor（在 `app/` 目录里做）

```bash
cd app
npm init -y                                        # 首次：生成 app/package.json（已有可跳过）
npm i @capacitor/core @capacitor/cli @capacitor/android

npx cap init "Live Dashboard" "com.example.livedashboard" --web-dir=../frontend/dist
npx cap add android
npx cap sync
```

会生成（都在 `app/` 里）：

```
app/
├── package.json               # 打包工程的依赖（与 frontend/package.json 无关）
├── capacitor.config.json      # 配置
├── android/                   # Android 工程（Android Studio 打开这个）
└── resources/                 # 图标/启动图源文件（见 2.5）
```

> `webDir` 指向 `../frontend/dist`——Capacitor 每次 `sync` 会把前端产物复制进 `app/android/app/src/main/assets/public`。**所以每次改完前端，只需在 `frontend/` 重新 build，再回 `app/` 执行 `npx cap sync`。**

### 2.3 配置 `app/capacitor.config.json`

内嵌本地产物（方案 B，推荐）：

```json
{
  "appId": "com.example.livedashboard",
  "appName": "Live Dashboard",
  "webDir": "../frontend/dist",
  "server": {
    "androidScheme": "https"
  }
}
```

如果你选方案 C（App 只是外壳，内容直接加载线上前端）：

```json
{
  "appId": "com.example.livedashboard",
  "appName": "Live Dashboard",
  "webDir": "../frontend/dist",
  "server": {
    "url": "https://web.example.com",
    "androidScheme": "https"
  }
}
```

> 方案 C 的好处是改了前端不用重新发版，坏处是断网就白屏、且 App 完全依赖线上域名。自用建议 B。

### 2.4 先跑起来看效果

```bash
cd app
npx cap sync          # frontend/dist 有改动就执行一次
npx cap open android  # 打开 Android Studio
```

Android Studio 里点 Run（绿色三角），连真机或开模拟器。首次会下载 Gradle 依赖，比较慢。

命令行方式也可以：

```bash
cd app/android
./gradlew assembleDebug          # Windows 用 gradlew.bat
# 产物：app/android/app/build/outputs/apk/debug/app-debug.apk
```

### 2.5 改名、包名、图标

| 要改的 | 位置 |
|---|---|
| 桌面显示的名字 | `app/android/app/src/main/res/values/strings.xml` 里的 `app_name` |
| 包名 / applicationId | `app/android/app/build.gradle` 的 `namespace` 和 `defaultConfig.applicationId` |
| 图标 / 启动图 | 在 `app/` 放 `resources/icon.png`（1024×1024）和 `resources/splash.png`，执行 `npx capacitor-assets generate --android` |

包名一旦发出去就不要再改，否则等于另一个 App。

### 2.6 签名并生成可安装的 APK

**① 生成签名证书**（只做一次，文件务必备份，丢了就不能给同一个 App 升级；建议放 `app/` 目录）：

```bash
cd app
keytool -genkey -v -keystore live-dashboard.keystore -alias live -keyalg RSA -keysize 2048 -validity 10000
```

**② 在 `app/android/app/build.gradle` 的 `android {}` 里加签名配置**：

```gradle
signingConfigs {
    release {
        storeFile file("../../../live-dashboard.keystore")
        storePassword "你的证书密码"
        keyAlias "live"
        keyPassword "你的证书密码"
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
    }
}
```

> `storeFile` 的路径相对 `app/android/app/`，所以 `../../../live-dashboard.keystore` 正好指到 `app/live-dashboard.keystore`。

> 密码别写死在仓库里。正式项目建议放 `~/.gradle/gradle.properties` 或 CI 的密钥变量。

**③ 打包**：

```bash
cd app/android
./gradlew assembleRelease        # Windows: gradlew.bat assembleRelease
# 产物：app/android/app/build/outputs/apk/release/app-release.apk
```

也可以直接 Android Studio：`Build → Generate Signed Bundle / APK → APK`。

### 2.7 安装与分发

```bash
adb install -r app-release.apk
```

或者把 APK 传到手机，点开安装（需要在系统设置里允许「安装未知来源应用」）。发给别人就传这个文件，不需要上架商店。

### 2.8 Android 侧注意事项

- **必须能访问后端**：`https://api.example.com` 要公网可达，且证书有效（自签证书 WebView 会拒绝）。
- **不要开明文 HTTP**：如果确实要用 http（不推荐），在 `AndroidManifest.xml` 的 `<application>` 上加 `android:usesCleartextTraffic="true"`。
- **后台断连**：App 切到后台后 SSE 会断开，回到前台自动重连；页面还有 20 秒轮询兜底，属正常现象。
- **导出 CSV**：Android WebView 默认不会处理 `Content-Disposition: attachment`，导出按钮可能点了没反应。临时办法是长按链接「在浏览器打开」；正式做法是接 `@capacitor/filesystem` + `@capacitor/share` 保存文件（见第 7 节）。
- **通知**：WebView 里的 `Notification` API 通常不可用，页面上的铃铛会提示不支持。要 App 内通知请用 `@capacitor/local-notifications`（见第 7 节）。

---

## 3. Windows 桌面版（Electron 打包 exe）

`app/` 里已经带了完整的 Electron 工程：`app/electron/main.js` + `app/package.json` 的 `build` 配置，**不用另外初始化**。

原理：Electron 窗口不直接打开 `file://` 的 index.html，而是先在本机 `127.0.0.1` 起一个只读静态服务托管 `frontend/dist`（随机端口、不对外），再用窗口加载它。这样 `/guide`、`/admin`、刷新、前进后退都和浏览器里完全一致，Vue Router 的 history 模式不用改。

### 3.1 环境准备

- Windows 10 / 11 x64
- Node.js 18+

首次 `npm install` 会从 GitHub 下载 Electron 二进制（约 100MB）。网络慢的话先设镜像：

```bat
npm config set ELECTRON_MIRROR https://npmmirror.com/mirrors/electron/
npm config set ELECTRON_BUILDER_BINARIES_MIRROR https://npmmirror.com/mirrors/electron-builder-binaries/
```

### 3.2 装依赖 + 构建前端

```bash
cd app
npm install            # 只装到 app/node_modules，不影响 frontend / backend

cd ../frontend
npm run build          # 确认 frontend/.env.production 里 VITE_API_BASE 已填后端域名
```

> 顺序很重要：Electron 打包时会把**当时**的 `frontend/dist` 复制进安装包（`extraResources`）。先 build 再打包。

### 3.3 本地预览（不打包）

```bash
cd app
npm run dev
```

会直接弹出桌面窗口。改前端后重新 `npm run build`，再 `npm run dev` 即可看到最新效果。

### 3.4 打包成 exe

```bash
cd app
npm run build:win
```

产物在 **`app/release/`**：

| 文件 | 说明 |
|---|---|
| `Live Dashboard Setup 1.0.0.exe` | NSIS 安装包：可选安装目录、自动建桌面快捷方式 |
| `Live Dashboard 1.0.0.exe` | 便携版：双击即用，不写注册表 |
| `win-unpacked/` | 解压即用的目录版（整个文件夹拷走也能跑） |

只想要目录版、想打包快一点：`npm run build:dir`（只出 `release/win-unpacked/`，不生成安装包）。

### 3.5 改名、图标、包信息

| 要改的 | 位置 |
|---|---|
| 窗口标题 | `app/electron/main.js` 里的 `title: 'Live Dashboard'` |
| 应用名 / 安装包名 | `app/package.json` → `build.productName` |
| appId（升级识别用） | `app/package.json` → `build.appId` |
| 图标 | 在 `app/resources/` 放 `icon.ico`（256×256），再在 `build.win` 加 `"icon": "resources/icon.ico"` |

> 没放 `icon.ico` 时会用 Electron 默认图标，不影响打包。

### 3.6 Windows 侧注意事项

- **代码签名**：未签名的 exe 首次运行会弹 SmartScreen「未知发布者」，点「更多信息 → 仍要运行」即可。要正式对外分发得买代码签名证书。
- **目标电脑不用装 Node.js**：Node 运行时、前端文件都已在 asar / resources 里。
- **改了前端要重新打包**：`cd frontend && npm run build` → `cd app && npm run build:win`；只改后端或站点配置不用动 exe。
- **登录态**：管理面板密码存在浏览器 localStorage，Electron 里同样持久化（在 `%APPDATA%\Live Dashboard` 下）。
- **不对外暴露端口**：本机静态服务只绑定 `127.0.0.1` + 随机端口，防火墙无需放行。
- **离线**：壳可以离线打开，但数据仍来自后端域名，后端不可达时页面会显示加载失败——这是预期行为。

---

## 4. iOS App

### 4.1 前提条件（硬性）

- 一台 **macOS**（必须有 Xcode，无法在 Windows 上出 iOS 包）
- **Xcode 15+**
- 免费 Apple ID 可以真机调试（7 天有效期，需重签）；
- 上 TestFlight / App Store 需要 **Apple Developer Program**（99 美元/年）

### 4.2 初始化（同样在 `app/` 里）

```bash
cd app
npm i @capacitor/core @capacitor/cli @capacitor/ios

npx cap init "Live Dashboard" "com.example.livedashboard" --web-dir=../frontend/dist
npx cap add ios          # 需要已安装 CocoaPods
npx cap sync
npx cap open ios         # 打开 Xcode
```

工程会生成在 `app/ios/`。

在 Xcode 里：

1. 选中 `App` target → **Signing & Capabilities** → 勾选 Automatically manage signing，选你的 Team；
2. 把 **Bundle Identifier** 改成自己的（和 Android 包名同风格，如 `com.yourname.livedashboard`）；
3. 选真机或模拟器点 Run。

### 4.3 上 TestFlight / App Store

1. Xcode：`Product → Archive`；
2. 在 Organizer 里 `Distribute App → App Store Connect → Upload`；
3. 打开 [App Store Connect](https://appstoreconnect.apple.com) 填应用信息，添加构建版本，先走 **TestFlight** 内测（这一步审核很宽松）；
4. 真要上架 App Store 需要完整审核，注意第 9 节的合规问题。

> **免费 Apple ID 的替代**：用 Sideloadly / AltStore 侧载自己打的 IPA，7 天要续签一次，适合自己用。

### 4.4 没有 Mac 怎么办

- 用 **PWA**（第 5 节），效果已经接近 App；
- 用云构建服务（Codemagic、Ionic Appflow、GitHub Actions + macOS runner）在云端出 IPA；
- 借一台 Mac / 用 TestFlight 云打包服务。

### 4.5 iOS 侧注意事项

- **ATS**：`https` 必须。若后端是 http，需要在 `Info.plist` 加 `NSAppTransportSecurity → NSAllowsArbitraryLoads = true`（不推荐，上架可能被问）。
- **导出的文件**同样需要 Filesystem / Share 插件配合。
- **Safari 与 WebView 的差异**：iOS WebView 对 `EventSource` 支持正常；后台会挂起，回前台重连。

---

## 5. 最省事：不打包，做成 PWA

Android Chrome：打开前端域名 → 右上角菜单 → **「安装应用」/「添加到主屏幕」**。
iOS Safari：分享按钮 → **「添加到主屏幕」**。
Windows Chrome / Edge：地址栏右侧的「安装」图标，或菜单 → **「安装 Live Dashboard」**（会在桌面/开始菜单生成独立窗口入口）。

项目已经带 `manifest.webmanifest` 和 iOS 相关 meta，加完就是全屏独立图标，不需要签名、不需要商店、不受 7 天限制。**如果你只是自己方便看，建议先用这个。**

想让它完全像 App（离线打开也算），可以再给 Vite 加 `vite-plugin-pwa` 生成 Service Worker；不加减也不影响使用（联网即可）。

---

## 6. 更新版本的标准流程

改了前端（样式、功能）之后：

```bash
cd frontend
npm run build

# Android / iOS
cd ../app
npx cap sync
npx cap open android

# Windows
cd ../app
npm run build:win
```

只改了后端（Node）或站点配置，**不需要动 App**，App 每次打开拉的就是后端最新数据。

---

## 7. App 内的两个已知差异（按需增强）

### 7.1 导出 CSV 没反应

WebView 不接管附件下载。增强方式（在 `app/` 装插件，需要原生层的都装在 `app/`）：

```bash
cd app
npm i @capacitor/filesystem @capacitor/share
npx cap sync
```

大致思路：用 `fetch` 拿 CSV 文本 → `Filesystem.writeFile` 写到文档目录 → `Share.share({ url })` 弹出系统分享。前端在 `exportUrl` 点击处判断 `window.Capacitor?.isNativePlatform?.()` 走这条分支，浏览器里保持现在的直接下载。

> Electron（Windows）里不受影响，`Content-Disposition: attachment` 会走 Chromium 下载流程，正常保存文件。

### 7.2 离线通知

`new Notification(...)` 在 Capacitor WebView 里不可靠。要的话：

```bash
cd app
npm i @capacitor/local-notifications
npx cap sync
```

在页面里检测到原生环境时，把「设备掉线」改为调用 `LocalNotifications.schedule(...)`，并先 `requestPermissions()`。注意这只是**前台监听时的本地通知**——App 被彻底关闭后不会提醒。

如果希望「App 关着也能收到掉线提醒」，正确做法不是加 App，而是**后端推送**：后端检测到设备离线后调用 Bark、Server 酱、飞书/钉钉机器人或 FCM。这是另一个功能，需要的话可以单独加。

---

## 8. 常见问题

| 现象 | 原因 / 解决 |
|---|---|
| App 打开白屏 | `webDir` 不是 `../frontend/dist`，或没执行 `npx cap sync`；也检查 `VITE_API_BASE` 是否为空导致请求发到 App 本地源 |
| exe 打开白屏 / 提示「找不到前端文件」 | 没先 `cd frontend && npm run build`；或打包时 dist 不存在（先构建再 `npm run build:win`） |
| 数据一直加载不出来 | API 域名不对 / 证书无效 / CORS 被改过；先用手机或浏览器打开 `https://api.example.com/api/health` 验证 |
| 点 `/guide`、`/admin` 白屏 | Capacitor 本地服务器一般能回退 index.html；若遇到，临时把 `createWebHistory` 换成 `createWebHashHistory` 再打包（Electron 版已用本机静态服务，不会出现） |
| 通知点了没反应 | WebView 不支持 `Notification`，用 7.2 的本地通知插件 |
| 导出按钮无反应 | 见 7.1 |
| exe 报「未知发布者」 | 未签名，Windows SmartScreen 提示；点「更多信息 → 仍要运行」，正式分发需代码签名 |
| 升级安装失败 | 签名不同（换了 keystore）；卸载旧版或用同一证书 |
| iOS 真机 7 天后失效 | 免费 Apple ID 限制，用 TestFlight 或开发者账号 |

---

## 9. 合规与安全提示

- 这是一个**设备活动监控**工具。安装到别人的手机上属于监控行为，**必须获得对方明确同意**，否则可能违法（各地隐私法规不同）。
- 上架 Google Play / App Store 对监控类应用审核严格，容易被拒；自用或小范围分发建议用 **APK 直装 / TestFlight 内测 / 免安装 exe / PWA**。
- App 与后端之间：电脑端已是密文上报；手机端（MacroDroid）是明文，务必走 HTTPS。App 只负责「看」，本身不上报任何数据。
- 不要把 `backend/config.json`、keystore、签名密码提交到公开仓库。

---

## 附：一页速查

```bash
# ① 打包前：构建前端（三个平台都要）
cd frontend && npm run build

# ② Android
cd ../app
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Live Dashboard" "com.example.livedashboard" --web-dir=../frontend/dist
npx cap add android && npx cap sync
npx cap open android
cd android && ./gradlew assembleRelease

# ③ iOS（macOS）
cd ../app && npm i @capacitor/ios
npx cap add ios && npx cap sync
npx cap open ios
# Xcode: Product → Archive → TestFlight

# ④ Windows（Electron，工程已就绪）
cd ../app && npm install
npm run dev          # 本地预览
npm run build:win    # 出安装包 + 便携版 → app/release/

# ⑤ 每次改完前端
cd ../frontend && npm run build && cd ../app && npx cap sync   # 手机端
cd ../frontend && npm run build && cd ../app && npm run build:win  # Windows
```
