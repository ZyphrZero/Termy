# GitHub Actions 工作流

## 工作流文件

### ci.yml - 插件 CI

**触发条件:**
- 推送到 `main` / `develop` 分支
- Pull Request
- 手动触发

**功能:**
- 安装依赖并校验 lockfile
- 构建 TypeScript 插件
- 运行终端层 Node 测试
- 运行发布脚本级测试（例如 R2 上传前置检查）

### build-rust.yml - CI 构建

**触发条件:**
- 推送到 `main` / `develop` 分支
- Pull Request
- 手动触发

**功能:**
- 构建 5 个平台的 `termy-server` 二进制
- 测试二进制启动和端口输出
- 使用 `Swatinem/rust-cache` 做 Rust 缓存

**平台:**
- Windows x64
- macOS ARM64 / x64
- Linux x64 / ARM64

### release.yml - 发布

**触发条件:**
- 推送版本标签 (`*.*.*`)

**功能:**
- 构建所有平台二进制 + SHA256 校验和
- 构建 TypeScript 插件
- 上传二进制到 Cloudflare R2
- 打包为 `termy.zip`
- 从 `CHANGELOG.md` 自动提取当前 tag 对应的发布说明
- 创建 GitHub Release

**产物结构:**
```
termy.zip
└── termy/
    ├── main.js
    ├── manifest.json
    ├── styles.css
    └── binaries/
        ├── termy-server-win32-x64.exe
        ├── termy-server-darwin-arm64
        ├── termy-server-darwin-x64
        ├── termy-server-linux-x64
        └── termy-server-linux-arm64
```

**发布说明来源:**
- `release.yml` 会读取 `CHANGELOG.md` 中与 tag 同名的章节，例如 tag `1.0.0` 对应 `## [1.0.0]`
- 如果找不到对应章节，Release 会失败，避免发布说明缺失或错配

**R2 同步:**
- `release.yml` 会调用 `scripts/upload-r2-assets.js`
- Release job 运行在 Node 20 上，并使用 `wrangler@4`
- 需要配置 GitHub Actions secrets:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`

## 使用

### 创建发布

```bash
# 更新 manifest.json 和 package.json 版本号
git tag 1.0.0
git push origin 1.0.0
```

### 手动触发 CI

GitHub → Actions → Build Rust Server → Run workflow

## 配置

- `GITHUB_TOKEN` - 自动提供
- `contents: write` - Release 权限

## 相关文件

- `scripts/build-rust.js` - 本地构建脚本
- `rust-servers/Cargo.toml` - Rust 配置
