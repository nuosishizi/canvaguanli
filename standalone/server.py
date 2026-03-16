import os
import io
import time
import zipfile
import uuid
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, jsonify, send_from_directory, make_response
from flask_cors import CORS
import requests

from calculate_app_hash import calculate_phash
from mam_db import DBManager

import sys

def get_dist_dir():
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, 'dist')
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist'))


import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

app = Flask(__name__)
CORS(app, render_errors=True, supports_credentials=True)

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# 使用系统临时目录，适应 MacOS 的 App Bundle 沙盒和 Windows 的 UAC 环境
import tempfile
TEMP_DIR = os.path.join(tempfile.gettempdir(), 'canva_tools_temp')
os.makedirs(TEMP_DIR, exist_ok=True)

file_store = {}
staged_store = {}
plugin_page_store = {}
pending_queue = []
executor = ThreadPoolExecutor(max_workers=10)

def guess_extension(content_type, fallback):
    if not content_type: return fallback
    normalized = content_type.split(";")[0].strip().lower()
    ext_map = {
        "video/mp4": ".mp4", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
        "application/pdf": ".pdf", "image/svg+xml": ".svg", 
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "application/zip": ".zip", "application/x-zip-compressed": ".zip",
    }
    return ext_map.get(normalized, fallback)

def sanitize_filename(name):
    return re.sub(r'[\\/:*?"<>|]', '_', name).strip()

@app.route('/health', methods=['GET'])
def health():
    print("[日志] 收到健康检查请求")
    return jsonify({"ok": True})

@app.route('/pre-stage-assets', methods=['POST'])
def pre_stage_assets():
    data = request.json or {}
    assets = data.get("assets", [])
    print(f"[日志] 收到预处理请求: 共 {len(assets)} 个素材。")
    if not assets:
        return jsonify({"staged": []})

    def process_asset(asset):
        try:
            print(f"[日志] 正在下载素材: {asset.get('label')} ...")
            r = requests.get(asset['url'], timeout=30)
            if r.status_code != 200: 
                print(f"[错误] 下载素材失败: {asset.get('label')}")
                return None

            fallback_ext = asset.get('urlExt') or (".mp4" if asset.get('assetType') == 'video' else ".jpg")
            ext = guess_extension(r.headers.get("content-type"), fallback_ext)
            filename = f"{sanitize_filename(asset['label'])}{ext}"

            staged_id = str(uuid.uuid4())
            temp_path = os.path.join(TEMP_DIR, f"{staged_id}_{filename}")
            with open(temp_path, "wb") as f:
                f.write(r.content)

            print(f"[日志] 正在计算指纹(pHash): {filename}")
            phash = calculate_phash(temp_path) or ""
            if os.path.exists(temp_path):
                os.remove(temp_path)

            staged_store[staged_id] = {"hash": phash, "fileName": filename}
            print(f"[日志] 素材 {filename} 预处理完成 (指纹: {phash[:8]}...)")
            return {"stagedId": staged_id, "label": asset['label']}
        except Exception as e:
            print(f"[错误] 预处理过程发生异常: {e}")
            return None

    results = list(executor.map(process_asset, assets))
    staged = [r for r in results if r]
    print(f"[日志] 成功预处理 {len(staged)}/{len(assets)} 个素材。")
    return jsonify({"staged": staged})

@app.route('/add-page-blob', methods=['POST'])
def add_page_blob():
    data = request.json or {}
    url = data.get("url")
    if not url: return jsonify({"ok": False})

    print(f"[日志] 收到录入页面请求 (第 {data.get('pageNum')} 页)")
    try:
        r = requests.get(url, timeout=60)
        ext = data.get("ext", "mp4")
        safe_name = sanitize_filename(data.get("projectName") or "Canva")
        page_num = str(data.get("pageNum", 0)).zfill(2)
        filename = f"{safe_name}_Page{page_num}.{ext}"

        plugin_page_store[filename] = {"buffer": r.content, "fileName": filename}
        print(f"[日志] 页面暂存成功: {filename}")
        return jsonify({"ok": True})
    except Exception as e:
        print(f"[错误] 页面暂存失败: {e}")
        return jsonify({"ok": False})

@app.route('/register-assets', methods=['POST'])
def register_assets():
    data = request.json or {}
    creator = data.get("creator", "")
    canva_id = data.get("canvaId", "")
    template_name = data.get("templateName", "")
    canva_user_id = data.get("canvaUserId", "")
    canva_app_id = data.get("canvaAppId", "")
    canva_brand_id = data.get("canvaBrandId", "")
    assets = data.get("assets", [])

    print(f"[日志] 准备将 {len(assets)} 个素材注册到数据库 (Canva ID: {canva_id}, 创建者: {creator})")
    if not canva_user_id or not canva_app_id:
        return jsonify({"error": "缺少 Canva 身份信息，请先在插件内完成授权识别"}), 400

    # 验证 App ID 是否与独立应用绑定的 App 一致
    standalone_app_id = os.environ.get('STANDALONE_APP_ID', '').strip()
    if standalone_app_id and canva_app_id != standalone_app_id:
        return jsonify({"error": f"App ID 不匹配：本服务已绑定到 App {standalone_app_id}，请求来自 App {canva_app_id}。请在独立应用中检查"Canva 应用绑定"配置。"}), 403

    if not assets:
        return jsonify({"error": "No assets provided"}), 400

    def process_reg(asset):
        staged_id = asset.get('stagedId')
        if staged_id and staged_id in staged_store:
            print(f"[日志] 使用已缓存的预处理文件: {staged_store[staged_id]['fileName']}")
            return staged_store[staged_id]['hash'], staged_store[staged_id]['fileName'], asset.get('assetType')
        try:
            print(f"[日志] 正在直接拉取并注册: {asset['label']}")
            r = requests.get(asset['url'], timeout=30)
            if r.status_code != 200: return None
            ext = guess_extension(r.headers.get("content-type"), ".mp4" if asset.get('assetType') == 'video' else ".jpg")
            filename = sanitize_filename(asset['label']) + ext
            temp_path = os.path.join(TEMP_DIR, f"{uuid.uuid4()}_{filename}")
            with open(temp_path, "wb") as f:
                f.write(r.content)
            print(f"[日志] 正在计算直接拉取文件的指纹: {filename}")
            phash = calculate_phash(temp_path) or ""
            if os.path.exists(temp_path): os.remove(temp_path)
            return phash, filename, asset.get('assetType')
        except Exception as e:
            print(f"[错误] 直接注册拉取失败: {e}")
            return None

    results = list(executor.map(process_reg, assets))
    resolved = [r for r in results if r and r[0]]

    if not resolved:
        print("[日志] 未发现需要入库的新素材。")
        return jsonify({"success": True, "count": 0})

    try:
        import json
        db = DBManager()
        db.connect()
        unique_hashes = list(set([r[0] for r in resolved]))
        print(f"[日志] 正在进行数据库查重 (验重数量: {len(unique_hashes)})")
        existing = db.get_assets_by_phashes(unique_hashes)

        rows_to_insert = []
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        for phash, filename, asset_type in resolved:
            exist = existing.get(phash)
            if exist and exist.get("producer", "").strip() and exist.get("producer", "").strip() != "未知":
                print(f"[日志] 数据库已存在跳过录入: {filename} (作者归属: {exist.get('producer')})")
                continue
            rows_to_insert.append((
                phash,
                filename,
                asset_type,
                0,
                creator,
                now_str,
                json.dumps(
                    {
                        "canva_id": canva_id,
                        "canva_user_id": canva_user_id,
                        "canva_app_id": canva_app_id,
                        "canva_brand_id": canva_brand_id,
                    },
                    ensure_ascii=False,
                ),
                None,
            ))

        if rows_to_insert:
            print(f"[日志] 正在批量写入 {len(rows_to_insert)} 条数据到数据库...")
            db.upsert_assets_bulk(rows_to_insert)

        if canva_id:
            print(f"[日志] 正在关联 Canva 模板到数据库: {template_name}")
            db.add_canva_template(
                canva_id,
                template_name,
                creator,
                unique_hashes,
                f"via local plugin; app={canva_app_id}; user={canva_user_id}",
            )
        
        print(f"[日志] 成功完成 {len(unique_hashes)} 个素材的注册扫描流程")
        return jsonify({"success": True, "count": len(unique_hashes)})
    except Exception as e:
        print(f"[错误] 更新数据库入库异常: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/pending', methods=['GET'])
def long_poll_pending():
    for _ in range(30):
        if pending_queue:
            item = pending_queue.pop(0)
            return jsonify(item)
        time.sleep(1)
    return jsonify({})

@app.route('/pack-plugin-pages', methods=['POST'])
def pack_plugin_pages():
    data = request.json or {}
    title = sanitize_filename(data.get("title") or "Unnamed_Export")
    print(f"[日志] 正在打包页面 ZIP: {title}.zip")
    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        if plugin_page_store:
            for fname, page_data in plugin_page_store.items():
                print(f"[日志] 添加文件到 ZIP: {fname}")
                zf.writestr(fname, page_data['buffer'])
        else:
            print("[日志] 没有收到任何画布页面，将生成空打包说明。")
            zf.writestr('empty.txt', b'no custom pages')
            
    plugin_page_store.clear()
    zip_id = str(uuid.uuid4())
    file_name = f"{title}.zip"
    file_store[zip_id] = {
        "buffer": zip_buffer.getvalue(),
        "fileName": file_name,
        "createdAt": time.time()
    }
    pending_queue.append({"id": zip_id, "fileName": file_name})
    print(f"[日志] 打包完成！下载标识: {zip_id[:8]}...")
    return jsonify({"success": True, "id": zip_id, "fileName": file_name})

@app.route('/download/<zip_id>', methods=['GET'])
def download_zip(zip_id):
    entry = file_store.get(zip_id)
    if not entry:
        print(f"[错误] 请求的下载文件不存在或已过期: {zip_id}")
        return "Not found or expired", 404
        
    print(f"[日志] 用户正在下载打包文件: {entry['fileName']}")
    response = make_response(entry["buffer"])
    encoded_name = urllib.parse.quote(entry["fileName"])
    response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_name}"
    response.headers["Content-Type"] = "application/zip"
    return response

# IMPORTANT: Catch-all to serve app.js or ANY other requested static files properly for Canva
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def catch_all(path):
    dist_dir = get_dist_dir()
    file_to_serve = path if path else 'app.js'
    target_path = os.path.join(dist_dir, file_to_serve)
    
    def serve_with_dynamic_host(file_path):
        # Read the built js file
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Replace hardcoded ports dynamically
        current_host = request.host_url.rstrip("/")
        content = content.replace("http://localhost:3001", current_host)
        
        # Optionally replace BACKEND_HOST if it compiled as undefined
        # For variable references that rely on BACKEND_HOST being injected globally:
        prefix = f'window.BACKEND_HOST = "{current_host}";\n'
        return make_response(prefix + content, 200, {'Content-Type': 'application/javascript'})

    # Canva requested exact file that exists
    if os.path.exists(target_path) and os.path.isfile(target_path):
        if file_to_serve.endswith('.js'):
            return serve_with_dynamic_host(target_path)
        return send_from_directory(dist_dir, file_to_serve)

    # Standard Canva request (usually root or an unknown path)
    if os.path.exists(os.path.join(dist_dir, 'app.js')):
        return serve_with_dynamic_host(os.path.join(dist_dir, 'app.js'))
