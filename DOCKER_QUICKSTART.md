# Docker 开发环境快速开始

## 🐳 为什么使用 Docker？

在 Ubuntu 22.04 上，系统的 GLIBC 版本较旧（2.35），无法运行最新版本的 Anchor CLI（需要 GLIBC 2.38+）。使用 Docker 可以：

- ✅ 使用 Ubuntu 24.04（GLIBC 2.39）
- ✅ 完整支持 Anchor 0.30.1
- ✅ 隔离的开发环境，不影响宿主机
- ✅ 一致的开发体验

## 🚀 快速开始

### 1. 构建 Docker 镜像

```bash
./docker-dev.sh build
```

这将创建一个包含以下工具的 Ubuntu 24.04 镜像：
- Node.js 20.x
- Rust (stable)
- Solana CLI 2.0.18
- Anchor CLI 0.30.1

**注意**：镜像不包含项目文件，所有文件通过挂载方式访问。

### 2. 启动开发容器

```bash
./docker-dev.sh start
```

容器启动后，bridge 目录将被挂载到容器的 `/workspace`。

### 3. 初始化环境（首次启动）

```bash
./docker-dev.sh init
```

这将在容器内：
- 安装所有 npm 依赖
- 编译 Solana 程序
- 创建必要的配置

**首次使用必须运行此命令！**

### 4. 进入容器 Shell

```bash
./docker-dev.sh shell
```

### 5. 在容器中运行 E2E 测试

进入容器后，运行：

```bash
npm run test:e2e
```

或者直接从宿主机运行：

```bash
./docker-dev.sh test
```

## 📋 可用命令

```bash
./docker-dev.sh [命令]
```

| 命令 | 说明 |
|------|------|
| `build` | 构建 Docker 镜像 |
| `start` | 启动开发容器（后台运行） |
| `init` | 初始化环境（首次启动后必须运行）|
| `stop` | 停止所有容器 |
| `restart` | 重启容器 |
| `test` | 在容器中运行 E2E 测试 |
| `shell` | 进入开发容器的交互式 shell |
| `logs` | 查看容器日志 |
| `clean` | 清理所有容器和卷 |
| `rebuild` | 重新构建镜像 |
| `status` | 查看容器状态 |

## 🔧 容器内开发

进入容器后，你可以：

### 运行完整 E2E 测试
```bash
npm run test:e2e
```

### 只部署 Arbitrum 合约
```bash
cd contracts
npx hardhat run scripts/deploy.js --network localhost
```

### 只构建 Solana 程序
```bash
cd programs/local-bridge
anchor build
```

### 初始化 Solana 桥接
```bash
npm run initialize:solana
```

### 运行 Relayer
```bash
npm run start:relayer
```

## 📦 容器卷管理

Docker Compose 配置了以下持久化卷：

- `cargo-cache`: Rust 依赖缓存
- `solana-cache`: Solana 工具缓存
- `node-modules`: Node.js 依赖

这些卷在容器重启后会保留，加快后续构建速度。

## 🌐 端口映射

容器暴露了以下端口到宿主机：

| 容器端口 | 宿主机端口 | 用途 |
|---------|-----------|------|
| 8899 | 8899 | Solana 测试验证器 RPC |
| 8545 | 8545 | Hardhat 节点 RPC |
| 9900 | 9900 | Solana WebSocket |
| 3000 | 3000 | 前端（预留） |

## 💡 开发工作流示例

### 完整开发流程

```bash
# 1. 构建镜像（首次运行）
./docker-dev.sh build

# 2. 启动容器
./docker-dev.sh start

# 3. 初始化环境（首次必须）
./docker-dev.sh init

# 4. 进入容器
./docker-dev.sh shell

# 5. 在容器内运行 E2E 测试
npm run test:e2e

# 6. 查看生成的配置
cat relayer/config/config.json | jq

# 7. 退出容器
exit

# 8. 停止容器
./docker-dev.sh stop
```

### 快速测试流程

```bash
# 直接从宿主机运行测试（无需进入容器）
./docker-dev.sh test
```

## 🔍 故障排除

### 端口已被占用

如果看到端口冲突错误：

```bash
# 在宿主机上停止占用端口的进程
pkill -f "solana-test-validator"
pkill -f "hardhat node"

# 或修改 docker-compose.yml 中的端口映射
```

### 重新构建镜像

如果依赖有更新或遇到奇怪的问题：

```bash
./docker-dev.sh rebuild
```

### 完全清理

如果需要从头开始：

```bash
./docker-dev.sh clean
./docker-dev.sh build
./docker-dev.sh start
```

### 查看容器日志

```bash
./docker-dev.sh logs
```

## 📝 与宿主机的文件同步

项目目录 `/home/ubuntu/ytest/bridge` 被挂载到容器的 `/workspace`。

- ✅ 在宿主机编辑代码，容器内立即生效
- ✅ 在容器内生成的文件，宿主机可以访问
- ✅ Git 操作在宿主机和容器都可以进行

## 🎯 下一步

1. **运行 E2E 测试**
   ```bash
   ./docker-dev.sh start
   ./docker-dev.sh shell
   npm run test:e2e
   ```

2. **开发新功能**
   - 在宿主机使用你喜欢的编辑器修改代码
   - 在容器内编译和测试

3. **部署到测试网**
   - 修改配置文件
   - 在容器内运行部署脚本

## ⚙️ 自定义配置

### 修改 Anchor 版本

编辑 `Dockerfile`:

```dockerfile
ENV ANCHOR_VERSION=0.30.1  # 改为你需要的版本
```

### 修改 Solana 版本

编辑 `Dockerfile`:

```dockerfile
ENV SOLANA_VERSION=2.0.18  # 改为你需要的版本
```

### 添加额外工具

在 `Dockerfile` 的 apt-get install 部分添加：

```dockerfile
RUN apt-get update && apt-get install -y \
    your-tool \
    another-tool \
    && rm -rf /var/lib/apt/lists/*
```

## 🚀 性能优化建议

1. **使用 Docker 缓存层**：修改 Dockerfile 时，把不常变的部分放在前面
2. **持久化卷**：已配置，无需额外操作
3. **多阶段构建**：如需优化镜像大小，可考虑多阶段构建

## 📚 相关文档

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [Anchor 文档](https://www.anchor-lang.com/)
- [Solana 文档](https://docs.solana.com/)

---

**Docker 环境已就绪，开始开发吧！** 🐳✨
