Write-Host "====================================="
Write-Host "Canva Tools - Windows Build Script"
Write-Host "====================================="

$TargetDir = $PSScriptRoot

Set-Location $TargetDir

Write-Host "[1/4] Webpack 前端构建..."
npm install
npm run build

Write-Host "[2/4] Python 依赖安装..."
# Assuming python is in PATH or specify alias
python -m pip install -r standalone\requirements.txt
python -m pip install pyinstaller

Write-Host "[3/4] 清理旧构建..."
Set-Location "$TargetDir\standalone"
Remove-Item -Recurse -Force build, dist, *.spec -ErrorAction SilentlyContinue

Write-Host "[4/4] 开始 PyInstaller 打包..."
# Windows 下 --add-data 必须用分号 ;
python -m PyInstaller -w -D --add-data "../dist;dist" main.py

Write-Host ">> 重命名最终目录..."
Rename-Item "$TargetDir\standalone\dist\main" "$TargetDir\standalone\dist\CanvaToolsApp" -ErrorAction SilentlyContinue

Write-Host ">> 打包为 ZIP 压缩包..."
Compress-Archive -Path "$TargetDir\standalone\dist\CanvaToolsApp" -DestinationPath "$TargetDir\CanvaToolsApp_Windows_Release.zip" -Force

Write-Host "====================================="
Write-Host "打包成功！产物位于: $TargetDir\CanvaToolsApp_Windows_Release.zip"
Write-Host "====================================="
