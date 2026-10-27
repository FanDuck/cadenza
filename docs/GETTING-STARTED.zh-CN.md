# 新手上手手册（零编程基础版）

这份手册写给「没写过代码、但想把这个项目跑起来并长期维护」的人。
不需要看懂所有代码，照着做就行。遇到报错，先看最后一节 **常见问题**。

---

## 1. 一次性准备（只做一次）

### 安装 Node.js

1. 打开 <https://nodejs.org>，下载 **LTS** 版本（左边那个绿色按钮）。
2. 双击安装，一路「下一步」。安装时如果看到 **Add to PATH** 的选项，保持勾选。
3. 装完后**重新打开一个 PowerShell 窗口**（重要，否则环境变量不生效），输入：

   ```powershell
   node --version
   ```

   看到类似 `v22.11.0` 就成功了。

### 安装 pnpm

在同一个 PowerShell 窗口里执行：

```powershell
npm install -g pnpm
pnpm --version
```

看到版本号（例如 `10.x`）即可。

### 获取代码

如果你已经把仓库克隆下来了：

```powershell
cd cadenza
```

没有的话：

```powershell
git clone https://github.com/FanDuck/cadenza.git
cd cadenza
```

---

## 2. 第一次运行

```powershell
pnpm install     # 下载依赖，第一次大约 1-3 分钟
pnpm start       # 编译并打开播放器
```

窗口打开后：

1. 点左下角 **Settings → Library**（设置 → 音乐库）。
2. 点 **Add folder**，选择一个装着 mp3 / flac 等音频的文件夹。
3. 等待扫描（右上角会显示进度），然后回到 **Library**，双击任意一首开始播放。

> 想先看看界面、不想加自己的音乐？执行 `pnpm demo`，
> 它会用示例数据在浏览器里打开同一套界面。

---

## 3. 生成 README 截图

```powershell
pnpm screenshot
```

会在 `screenshots/app.png` 生成一张真实窗口截图。
把这张图替换到 README 里，你的项目主页就有图了：

```markdown
![Cadenza](screenshots/app.png)
```

---

## 4. 装一个插件试试

1. 在资源管理器地址栏输入 `%APPDATA%\Cadenza`，回车。
2. 进入 `plugins` 文件夹（没有就新建）。
3. 把项目里的 `examples\plugins\hello-world` **整个文件夹**复制进去。
4. 回到播放器：**Settings → Plugins → Reload plugins**。
5. 按 `Ctrl+K` 打开命令面板，输入 `hello`，回车。

侧边栏底部会出现一个「👋 Wave」按钮，说明插件生效了。

---

## 5. 换主题 / 改颜色

**Settings → Appearance** 里有三套主题（Midnight / Daylight / Synthwave）和七种强调色。

想自己定义一套？看 [`docs/THEMING.md`](THEMING.md)，本质就是改几个颜色变量，
复制一段 JSON 改改数值即可。

---

## 6. 改完代码后怎么保存到 GitHub

只需要记住三条命令（在项目根目录执行）：

```powershell
git status                 # 看看改了哪些文件
git add -A                 # 把改动加入待提交
git commit -m "描述你改了什么"   # 提交（引号里的中文可以用）
git push                   # 推送到 GitHub
```

如果 `git push` 要求登录，用 GitHub 网页版的 **Personal Access Token** 当密码
（和发布时用的一样）。

> 修改代码前建议先 `git pull`，把 GitHub 上的最新版本拉下来。

---

## 7. 常用命令速查

| 命令 | 作用 |
| --- | --- |
| `pnpm start` | 编译并打开播放器 |
| `pnpm demo` | 浏览器里看界面（示例数据） |
| `pnpm test` | 跑全部测试（99 个） |
| `pnpm screenshot` | 保存截图到 `screenshots/app.png` |
| `pnpm build` | 只编译 |
| `pnpm package` | 打包成可分发目录 `release/app` |

---

## 8. 常见问题

**`pnpm : 无法将"pnpm"项识别为 cmdlet...`**
Node 没装好，或者装完没有重开 PowerShell。重开窗口再试；仍不行就重装 Node。

**`pnpm install` 卡住或报网络错误**
先执行 `pnpm config set registry https://registry.npmmirror.com`（国内镜像），再重试。

**`Electron failed to install correctly`**
删掉 `node_modules` 文件夹，重新 `pnpm install`。

**打开后是空白窗口**
按 `Ctrl+Shift+I` 打开开发者工具，看 Console 里的红色报错。多半是 `pnpm build` 没跑完整，
执行一次 `pnpm build` 再 `pnpm start`。

**加了文件夹但没有歌**
确认文件夹里确实有 `.mp3` `.flac` `.m4a` `.wav` `.ogg` 等文件；
扫描是递归的，子文件夹也会被读取。

**播放没声音**
调大播放器音量、检查系统音量输出设备；某些 `.wma` / `.aiff` 文件受解码器限制可能无法播放。

**想彻底重来**
删掉 `node_modules`、`.tmp`、`apps/desktop/dist`、`packages/*/dist`，然后重新 `pnpm install && pnpm start`。

---

## 9. 这个项目里各个文件夹是干什么的

| 路径 | 内容 |
| --- | --- |
| `packages/core` | 播放引擎：队列、播放器、音乐库、标签解析、歌词、歌单、插件系统 |
| `packages/ui` | 界面组件（`<cz-*>`）与主题变量 |
| `apps/desktop` | 桌面程序：Electron 主进程 + preload + 参考界面 |
| `examples/plugins` | 示例插件，可复制到 `%APPDATA%\Cadenza\plugins` 试用 |
| `docs/` | 架构、插件 API、主题、嵌入、路线图 |
| `scripts/` | 构建、演示服务器、图标生成等工具 |

---

有任何一步卡住，把**报错原文**复制下来问我即可。
