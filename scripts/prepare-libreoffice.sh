#!/usr/bin/env bash
# 下载对应平台的 LibreOffice 到 vendor/libreoffice/（不提交 git，.gitignore 忽略）。
# 构建前执行；macOS 用官方 dmg，Windows（CI）用官方 msi。
# 可用环境变量覆盖：
#   LIBREOFFICE_VERSION  （如 24.8.4）
#   LIBREOFFICE_URL      （完整下载根 URL，可指向镜像）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor/libreoffice"
VERSION="${LIBREOFFICE_VERSION:-25.8.7}"
BASE_URL="${LIBREOFFICE_URL:-https://download.documentfoundation.org/libreoffice/stable/${VERSION}}"

# 已就绪则跳过
if [[ -x "$VENDOR/LibreOffice.app/Contents/MacOS/soffice" || -x "$VENDOR/program/soffice.exe" ]]; then
  echo "vendor/libreoffice 已存在，跳过下载"
  exit 0
fi

mkdir -p "$VENDOR"

case "$(uname -s)" in
  Darwin)
    ARCH="$(uname -m)"
    # uname 输出 x86_64/arm64，官方 dmg 文件名用 x86-64/aarch64
    case "$ARCH" in
      arm64)  FILE_ARCH="aarch64" ;;
      x86_64) FILE_ARCH="x86-64" ;;
      *)      FILE_ARCH="$ARCH" ;;
    esac
    DMG="LibreOffice_${VERSION}_MacOS_${FILE_ARCH}.dmg"
    URL="${BASE_URL}/mac/${ARCH}/${DMG}"
    echo "下载 ${URL}"
    curl -fL --retry 3 -o /tmp/xhs_lo.dmg "$URL"
    MOUNT="$(hdiutil attach /tmp/xhs_lo.dmg -nobrowse | awk -F'\t' 'END{print $3}')"
    cp -R "$MOUNT/LibreOffice.app" "$VENDOR/LibreOffice.app"
    hdiutil detach "$MOUNT" >/dev/null
    rm -f /tmp/xhs_lo.dmg
    echo "已解压到 vendor/libreoffice/LibreOffice.app"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    MSI="LibreOffice_${VERSION}_Win_x86-64.msi"
    URL="${BASE_URL}/win/x86_64/${MSI}"
    echo "下载 ${URL}"
    curl -fL --retry 3 -o /tmp/xhs_lo.msi "$URL"
    INSTALL_DIR="/tmp/xhs_lo_install"
    msiexec //i "$(cygpath -w /tmp/xhs_lo.msi)" //qn TARGETDIR="$(cygpath -w "$INSTALL_DIR")" //norestart
    cp -R "$INSTALL_DIR/program" "$VENDOR/program"
    msiexec //x "$(cygpath -w /tmp/xhs_lo.msi)" //qn
    rm -f /tmp/xhs_lo.msi
    echo "已解压到 vendor/libreoffice/program"
    ;;
  *)
    echo "不支持平台: $(uname -s)" >&2
    exit 1
    ;;
esac
