FROM node:20-bookworm-slim AS base
# CN=1（默认，国内服务器）：apt 换阿里云源、npm 换 npmmirror、prisma 引擎走 npmmirror，避免 deb.debian.org 被重置/超时。
# 本地/海外构建传 --build-arg CN=0 走上游源（mirrors.aliyun.com 在海外/本地不一定可达）。
ARG CN=1
RUN if [ "$CN" = "1" ]; then sed -i -e 's|deb.debian.org|mirrors.aliyun.com|g' -e 's|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; fi; \
    apt-get update && apt-get install -y curl ca-certificates fonts-noto-cjk fontconfig && rm -rf /var/lib/apt/lists/*
# ---- ffmpeg：钉死版本，不用发行版自带的 ----
# 原本走 `apt-get install ffmpeg`，装到的是 Debian 12 自带的 5.1.9-0+deb12u1。
# 那个构建上出过一次全线事故：加了 zoompan 之后每条成片从约 2 秒起画面定格、字幕整条消失
# （服务器实测：同机同输入，过 zoompan 冻、不过正常）。
#
# 注意结论的边界：**没有**证据表明这是「老版本的已知 bug」——用上游 5.1 与 7.1 的静态构建、
# 喂同样的输入，两种滤镜写法都复现不出来。所以真正的问题是
# 「发行版打过补丁的那个二进制行为不可控」，而不是「版本旧」。
#
# 因此改成下载**固定版本**的静态二进制：
#   1. 版本写死在 ARG 里，升级是一次显式改动，不会随基础镜像悄悄漂移
#   2. 本地开发与服务器跑的是同一个二进制，滤镜行为差异这个变量被彻底消掉
#   3. 静态构建自带 libass/freetype/fontconfig/x264，所需滤镜齐全（构建期逐个自检）
#
# ffv1 编码器也要自检：开场碎裂的坐标表用它无损存盘，坐标错一位碎片就会从画面
# 另一头取色，不能退化到有损编码。
#
# **不从 Docker Hub 拉镜像**：服务器的镜像加速源只代理官方 library/* 镜像，
# 用户镜像（mwader/static-ffmpeg 之类）一律 403。走 HTTPS 下二进制则与 npm 同一条通路。
# 版本钉在这里。改它是一次显式改动，不会随基础镜像悄悄漂移。
# b6.1.1 这个目录里放的其实是 johnvansickle 的 **ffmpeg 7.0.2** 静态构建
#（目录名是 ffmpeg-static 这个 npm 包的版本号，不是 ffmpeg 的版本号）。
ARG FFMPEG_BASE_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) A=linux-x64 ;; \
      arm64) A=linux-arm64 ;; \
      armhf) A=linux-arm ;; \
      *) echo "不支持的架构: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/ffmpeg  "${FFMPEG_BASE_URL}/ffmpeg-${A}"; \
    curl -fsSL -o /usr/local/bin/ffprobe "${FFMPEG_BASE_URL}/ffprobe-${A}"; \
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe; \
    ffmpeg -version | head -1; \
    for f in zoompan xfade overlay subtitles ass concat displace geq eq crop scale \
             remap maskedmerge gblur rgbashift blend; do \
      ffmpeg -hide_banner -filters | awk '{print $2}' | grep -qx "$f" || { echo "缺滤镜: $f" >&2; exit 1; }; \
    done; \
    for e in libx264 ffv1; do \
      ffmpeg -hide_banner -encoders | awk '{print $2}' | grep -qx "$e" || { echo "缺编码器: $e" >&2; exit 1; }; \
    done

# 渲染全程只用 ffmpeg，不再需要系统 Chromium（原先开场碎裂靠无头浏览器截帧）。
WORKDIR /app
COPY package.json package-lock.json* ./
COPY web/package.json web/
COPY worker/package.json worker/
COPY packages/db/package.json packages/db/
RUN if [ "$CN" = "1" ]; then npm install --registry=https://registry.npmmirror.com; else npm install; fi

FROM base AS prod
ARG CN=1
ENV NODE_ENV=production
COPY . .
RUN if [ "$CN" = "1" ]; then export PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma; fi; \
    npx prisma generate --schema packages/db/prisma/schema.prisma
CMD ["npm", "run", "start", "-w", "worker"]
