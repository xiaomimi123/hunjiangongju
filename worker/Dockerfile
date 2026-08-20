# ffmpeg 版本钉在这里。改它是一次显式改动，不会随基础镜像悄悄漂移。
# 必须用「全局 ARG + 命名构建阶段」而不是 `COPY --from=image:${ARG}`：
# 本仓因中文路径必须禁用 BuildKit（DOCKER_BUILDKIT=0），经典构建器不展开
# COPY --from 里的变量镜像引用，只有 FROM 行认全局 ARG。
ARG FFMPEG_VERSION=7.1
FROM mwader/static-ffmpeg:${FFMPEG_VERSION} AS ffmpeg

FROM node:20-bookworm-slim AS base
# CN=1（默认，国内服务器）：apt 换阿里云源、npm 换 npmmirror、prisma 引擎走 npmmirror，避免 deb.debian.org 被重置/超时。
# 本地/海外构建传 --build-arg CN=0 走上游源（mirrors.aliyun.com 在海外/本地不一定可达）。
ARG CN=1
RUN if [ "$CN" = "1" ]; then sed -i -e 's|deb.debian.org|mirrors.aliyun.com|g' -e 's|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; fi; \
    apt-get update && apt-get install -y fonts-noto-cjk fontconfig chromium && rm -rf /var/lib/apt/lists/*
# ---- ffmpeg：钉死版本，不用发行版自带的 ----
# 原本走 `apt-get install ffmpeg`，装到的是 Debian 12 自带的 5.1.9-0+deb12u1。
# 那个构建上出过一次全线事故：加了 zoompan 之后每条成片从约 2 秒起画面定格、字幕整条消失
# （服务器实测：同机同输入，过 zoompan 冻、不过正常）。
#
# 注意结论的边界：**没有**证据表明这是「老版本的已知 bug」——用上游 5.1 与 7.1 的静态构建、
# 喂同样的 HyperFrames 输出，两种滤镜写法都复现不出来。所以真正的问题是
# 「发行版打过补丁的那个二进制行为不可控」，而不是「版本旧」。
#
# 因此这里改成从 mwader/static-ffmpeg 拷贝**固定版本**的静态二进制：
#   1. 版本写死在 ARG 里，升级是一次显式改动，不会随基础镜像悄悄漂移
#   2. 本地开发与服务器跑的是同一个二进制，滤镜行为差异这个变量被彻底消掉
#   3. 静态构建自带 libass/freetype/fontconfig/x264，FFmpeg 渲染迁移所需滤镜齐全
#      （已核验：zoompan/xfade/overlay/subtitles/ass/drawtext/concat/alphamerge/rotate/crop/scale/eq/curves + libx264/aac）
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
# 构建期自检：版本不是钉住的那个就直接失败，别等到线上才发现
RUN ffmpeg -version | head -1 && ffmpeg -hide_banner -filters | grep -qw xfade && ffmpeg -hide_banner -filters | grep -qw subtitles

# HyperFrames(render-visuals) 用无头浏览器截帧渲染，需系统 Chromium；渲染代码默认读 /usr/bin/chromium
ENV HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium
# hyperframes 依赖 onnxruntime-node，其安装脚本从 github 下载原生库（国内 302 失败）；跳过——本项目渲染不走 ONNX 推理
ENV ONNXRUNTIME_NODE_INSTALL=skip
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
