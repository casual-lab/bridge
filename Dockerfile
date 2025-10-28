# Arbitrum ↔ Solana 跨链桥开发环境
# 基于 Ubuntu 24.04 LTS
FROM ubuntu:24.04

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=20
ENV RUST_VERSION=stable
ENV SOLANA_VERSION=2.0.18
ENV ANCHOR_VERSION=0.30.1

# 设置工作目录
WORKDIR /workspace

# 更新系统并安装基础工具
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    libudev-dev \
    ca-certificates \
    gnupg \
    jq \
    vim \
    && rm -rf /var/lib/apt/lists/*

# 安装 Node.js 20.x
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest yarn

# 安装 Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && . $HOME/.cargo/env \
    && rustup component add rustfmt clippy

# 添加 Cargo 到 PATH
ENV PATH="/root/.cargo/bin:${PATH}"

# # 安装 Solana CLI 并设置 PATH
# RUN sh -c "$(curl -sSfL https://release.solana.com/v${SOLANA_VERSION}/install)" && \
#     export PATH="/root/.local/share/solana/install/active_release/bin:$PATH" && \
#     mkdir -p /root/.config/solana && \
#     solana-keygen new --no-bip39-passphrase -o /root/.config/solana/id.json --force && \
#     solana config set --url http://127.0.0.1:8899 && \
#     solana config set --keypair /root/.config/solana/id.json

# ENV PATH="/root/.local/share/solana/install/active_release/bin:${PATH}"

# # 安装 AVM (Anchor Version Manager) 并使用它安装 Anchor
# RUN cargo install --git https://github.com/coral-xyz/anchor avm --force --locked && \
#     /root/.cargo/bin/avm install latest && \
#     /root/.cargo/bin/avm use latest

RUN curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
RUN export PATH="/root/.local/share/solana/install/active_release/bin:$PATH" && rustc --version && solana --version && anchor --version && node --version && yarn --version
RUN mkdir -p /root/.config/solana && \
    solana-keygen new --no-bip39-passphrase -o /root/.config/solana/id.json --force && \
    solana config set --url http://127.0.0.1:8899 && \
    solana config set --keypair /root/.config/solana/id.json


# 添加 AVM 到 PATH
ENV PATH="/root/.avm/bin:${PATH}"

# 设置工作目录
WORKDIR /workspace

# 暴露端口
EXPOSE 8899 8545 9900

# 设置入口点
CMD ["/bin/bash"]
