#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY="${FARM_REPOSITORY:-edison-labs/farm-journal}"
SOURCE_REF="${1:-master}"
PUBLIC_PORT="${FARM_PORT:-8080}"
RELEASE_ROOT="${FARM_RELEASE_ROOT:-/var/www/farm-journal-releases}"
NGINX_IMAGE="${FARM_NGINX_IMAGE:-nginx:1.21.5}"

if [[ "${EUID}" -ne 0 ]]; then
    echo "请用 root 运行：sudo bash $0 ${SOURCE_REF}"
    exit 1
fi

for command_name in curl tar docker sed grep sha256sum; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
        echo "缺少命令：${command_name}"
        exit 1
    fi
done

WORK_DIR="$(mktemp -d /tmp/farm-journal-update.XXXXXX)"
ARCHIVE_PATH="${WORK_DIR}/source.tar.gz"
NEW_CONTAINER=""
OLD_CONTAINER=""
NEW_STARTED=false

cleanup() {
    rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

rollback() {
    echo "更新失败，正在恢复旧版本……"
    if [[ "${NEW_STARTED}" == true && -n "${NEW_CONTAINER}" ]]; then
        docker stop "${NEW_CONTAINER}" >/dev/null 2>&1 || true
        docker rm "${NEW_CONTAINER}" >/dev/null 2>&1 || true
    fi
    if [[ -n "${OLD_CONTAINER}" ]]; then
        docker start "${OLD_CONTAINER}" >/dev/null 2>&1 || true
    fi
}

echo "1/5 下载 ${REPOSITORY} 的 ${SOURCE_REF} 版本……"
curl -fL \
    --connect-timeout 15 \
    --max-time 180 \
    --retry 3 \
    --retry-delay 2 \
    "https://codeload.github.com/${REPOSITORY}/tar.gz/${SOURCE_REF}" \
    -o "${ARCHIVE_PATH}"

tar -xzf "${ARCHIVE_PATH}" -C "${WORK_DIR}"
SOURCE_DIR="$(find "${WORK_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"

if [[ -z "${SOURCE_DIR}" || ! -f "${SOURCE_DIR}/dist/index.html" || ! -f "${SOURCE_DIR}/dist/app-version.json" ]]; then
    echo "下载内容不完整：缺少 dist/index.html 或 dist/app-version.json。"
    exit 1
fi

if [[ ! -f "${SOURCE_DIR}/deploy/nginx.conf" ]]; then
    echo "下载内容不完整：缺少 deploy/nginx.conf。"
    exit 1
fi

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${SOURCE_DIR}/dist/app-version.json" | head -n 1)"
if [[ -z "${VERSION}" ]]; then
    echo "无法读取 app-version.json 中的版本号。"
    exit 1
fi

SAFE_VERSION="$(printf '%s' "${VERSION}" | tr -c '[:alnum:]._- ' '_' | tr -d ' ')"
RELEASE_ID="${SAFE_VERSION}-$(date +%Y%m%d-%H%M%S)"
RELEASE_DIR="${RELEASE_ROOT}/${RELEASE_ID}"
SITE_DIR="${RELEASE_DIR}/site"
CONFIG_PATH="${RELEASE_DIR}/nginx.conf"

echo "2/5 创建全新发布目录 ${RELEASE_DIR}……"
mkdir -p "${SITE_DIR}"
cp -a "${SOURCE_DIR}/dist/." "${SITE_DIR}/"
cp "${SOURCE_DIR}/deploy/nginx.conf" "${CONFIG_PATH}"

grep -Fq "src/presentation/styles.css?v=${VERSION}" "${SITE_DIR}/index.html" || {
    echo "发布检查失败：index.html 未引用当前版本的样式。"
    exit 1
}
grep -Fq "src/presentation/app.js?v=${VERSION}" "${SITE_DIR}/index.html" || {
    echo "发布检查失败：index.html 未引用当前版本的脚本。"
    exit 1
}

echo "3/5 检查 Nginx 配置……"
docker run --rm \
    -v "${SITE_DIR}:/usr/share/nginx/html:ro" \
    -v "${CONFIG_PATH}:/etc/nginx/conf.d/default.conf:ro" \
    "${NGINX_IMAGE}" nginx -t

OLD_CONTAINER="$(docker ps --filter "publish=${PUBLIC_PORT}" --format '{{.ID}}' | head -n 1)"
NEW_CONTAINER="farm-journal-${SAFE_VERSION}-$(date +%s)"

echo "4/5 切换 ${PUBLIC_PORT} 端口上的服务……"
if [[ -n "${OLD_CONTAINER}" ]]; then
    docker stop "${OLD_CONTAINER}" >/dev/null
fi

if ! docker run -d \
    --name "${NEW_CONTAINER}" \
    --restart unless-stopped \
    -p "${PUBLIC_PORT}:80" \
    -v "${SITE_DIR}:/usr/share/nginx/html:ro" \
    -v "${CONFIG_PATH}:/etc/nginx/conf.d/default.conf:ro" \
    "${NGINX_IMAGE}" >/dev/null; then
    rollback
    exit 1
fi
NEW_STARTED=true

echo "5/5 验证新服务……"
SERVICE_READY=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 5 "http://127.0.0.1:${PUBLIC_PORT}/app-version.json?check=$(date +%s)" \
        | grep -q "\"version\"[[:space:]]*:[[:space:]]*\"${VERSION}\""; then
        SERVICE_READY=true
        break
    fi
    sleep 1
done

if [[ "${SERVICE_READY}" != true ]]; then
    rollback
    exit 1
fi

for asset_path in \
    index.html \
    app-version.json \
    src/presentation/app.js \
    src/presentation/styles.css; do
    served_path="${WORK_DIR}/served-$(basename "${asset_path}")"
    if ! curl -fsS --max-time 10 \
        "http://127.0.0.1:${PUBLIC_PORT}/${asset_path}?check=$(date +%s)" \
        -o "${served_path}"; then
        echo "无法读取新服务中的 ${asset_path}。"
        rollback
        exit 1
    fi

    release_hash="$(sha256sum "${SITE_DIR}/${asset_path}" | awk '{print $1}')"
    served_hash="$(sha256sum "${served_path}" | awk '{print $1}')"
    if [[ "${release_hash}" != "${served_hash}" ]]; then
        echo "文件检查失败：服务器返回的 ${asset_path} 与新版本不一致。"
        rollback
        exit 1
    fi
done

ln -sfn "${RELEASE_DIR}" "${RELEASE_ROOT}/current"

echo
echo "更新完成：${VERSION}"
echo "访问地址：http://服务器IP:${PUBLIC_PORT}/"
echo "当前容器：${NEW_CONTAINER}"
if [[ -n "${OLD_CONTAINER}" ]]; then
    echo "旧容器已停止并保留：${OLD_CONTAINER}"
    echo "需要回退时运行：docker stop ${NEW_CONTAINER} && docker start ${OLD_CONTAINER}"
fi
