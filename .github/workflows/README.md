# GitHub Actions 工作流

## 工作流文件

### build-rust.yml - CI 构建

**触发条件:**
- 推送到 `main` / `develop` 分支
- Pull Request
- 手动触发

**功能:**
- 构建 5 个平台的 `termy-server` 二进制
- 测试二进制启动和端口输出

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
- 打包为 `obsidian-termy.zip`
- 创建 GitHub Release

**产物结构:**
```
obsidian-termy.zip
└── obsidian-termy/
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
