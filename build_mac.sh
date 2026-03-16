#!/bin/bash

echo "====================================="
echo "Canva Tools - Mac Build Script"
echo "====================================="

# 确保我们在项目根目录
cd "$(dirname "$0")"

echo "[1/4] 安装依赖..."
# 需要确保用户安装了 node / npm
if ! command -v npm &> /dev/null; then
    echo "[!] 未检测到 npm，请先安装 Node.js"
    exit 1
fi

npm install
npm run build

echo "[2/4] 安装 Python 依赖..."
# 检查 Python3
if ! command -v python3 &> /dev/null; then
    echo "[!] 未检测到 python3，请先安装 Python"
    exit 1
fi

python3 -m pip install -r standalone/requirements.txt || {
    echo "[!] Pip 依赖安装失败！"
    exit 1
}

# 必须安装 PyInstaller
python3 -m pip install pyinstaller

echo "[3/4] 清理旧的构建文件..."
cd standalone
rm -rf build dist *.spec

echo "[4/4] 使用 PyInstaller 打包 Mac 应用..."
# macOS 使用 -w 参数即可打包出 .app 格式，使用 --onedir 以避免解压过慢带来的问题
python3 -m PyInstaller -w -D --add-data "../dist:dist" main.py

# 顺便打个 zip 包方便传输
cd dist
echo ">> 正在将打包后的应用压缩为 ZIP..."
zip -r CanvaToolsApp_Mac.zip main.app

echo "====================================="
echo "打包完成！生成的 App 位于:"
echo "$(pwd)/main.app"
echo "====================================="
