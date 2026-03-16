import os
import io
import time
import zipfile
import uuid
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, jsonify, send_file, send_from_directory, make_response
from flask_cors import CORS
import requests

from standalone.calculate_app_hash import calculate_phash
from standalone.mam_db import DBManager

app = Flask(__name__)
CORS(app, cors_allowed_origins="*")

TEMP_DIR = os.path.join(os.path.dirname(__file__), 'temp')
os.makedirs(TEMP_DIR, exist_ok=True)

# 内存状态
file_store = {}        # { id: {"buffer": bytes, "fileName": str, "createdAt": float} }
staged_store = {}      # { id: {"hash": str, "fileName": str} }
plugin_page_store = {} # { fileName: {"buffer": bytes, "fileName": str} }
pending_queue = []     # List of dicts

executor = ThreadPoolExecutor(max_workers=10)

def guess_extension(content_type, fallback):
    if not content_type: return fallback
    normalized = content_type.split(";")[0].strip().lower()
    ext_map = {
        "video/mp4": ".mp4",
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "application/pdf": ".pdf",
        "image/svg+xml": ".svg",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "application/zip": ".zip",
        "application/x-zip-compressed": ".zip",
    }
    return ext_map.get(normalized, fallback)

def sanitize_filename(name):
    return re.sub(r'[\\/:*?"<>|]', '_', name).strip()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"ok": True})

@app.route('/pre-stage-assets', methods=['POST'])
def pre_stage_assets():
    data = request.json or {}
    assets = data.get("assets", [])
    if not assets:
        return jsonify({"staged": []})

    def process_asset(asset):
        try:
            r = requests.get(asset['url'], timeout=30)
            if r.status_code != 200: return None
            
            content_type = r.headers.get("content-type")
            fallback_ext = asset.get('urlExt') or (".mp4" if asset.get('assetType') == 'video' else ".jpg")
            ext = guess_extension(content_type, fallback_ext)
            filename = f"{sanitize_filename(asset['label'])}{ext}"
            
            staged_id = str(uuid.uuid4())
            temp_path = os.path.join(TEMP_DIR, f"{staged_id}_{filename}")
            with open(temp_path, "wb") as f:
                f.write(r.content)
            
            phash = calculate_phash(temp_path) or ""
            if os.path.exists(temp_path):
                os.remove(temp_path)
            
            staged_store[staged_id] = {"hash": phash, "fileName": filename}
            return {"stagedId": staged_id, "label": asset['label']}
        except Exception as e:
            print(f"Pre-stage failed: {e}")
            return None

    results = list(executor.map(process_asset, assets))
    staged = [r for r in results if r]
    return jsonify({"staged": staged})

@app.route('/add-page-blob', methods=['POST'])
def add_page_blob():
    data = request.json or {}
    url = data.get("url")
    if not url: return jsonify({"ok": False})
    
    try:
        r = requests.get(url, timeout=60)
        ext = data.get("ext", "mp4")
        safe_name = sanitize_filename(data.get("projectName") or "Canva")
        page_num = str(data.get("pageNum", 0)).zfill(2)
        filename = f"{safe_name}_Page{page_num}.{ext}"
        
        plugin_page_store[filename] = {"buffer": r.content, "fileName": filename}
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"ok": False})

@app.route('/register-assets', methods=['POST'])
def register_assets():
    data = request.json or {}
    creator = data.get("creator", "")
    canva_id = data.get("canvaId", "")
    template_name = data.get("templateName", "")
    assets = data.get("assets", [])

    if not assets:
        return jsonify({"error": "No assets provided"}), 400

    def process_reg(asset):
        staged_id = asset.get('stagedId')
        if staged_id and staged_id in staged_store:
            return staged_store[staged_id]['hash'], staged_store[staged_id]['fileName'], asset.get('assetType')
        
        try:
            r = requests.get(asset['url'], timeout=30)
            if r.status_code != 200: return None
            
            ext = guess_extension(r.headers.get("content-type"), ".mp4" if asset.get('assetType') == 'video' else ".jpg")
            filename = sanitize_filename(asset['label']) + ext
            
            staged_id = str(uuid.uuid4())
            temp_path = os.path.join(TEMP_DIR, f"{staged_id}_{filename}")
            with open(temp_path, "wb") as f:
                f.write(r.content)
            
            phash = calculate_phash(temp_path) or ""
            if os.path.exists(temp_path): os.remove(temp_path)
            
            return phash, filename, asset.get('assetType')
        except Exception:
            return None

    results = list(executor.map(process_reg, assets))
    resolved = [r for r in results if r and r[0]]
    
    if not resolved:
        return jsonify({"success": True, "count": 0})

    try:
        import json
        db = DBManager()
        db.connect()
        unique_hashes = list(set([r[0] for r in resolved]))
        existing = db.get_assets_by_phashes(unique_hashes)
        
        rows_to_insert = []
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        for phash, filename, asset_type in resolved:
            exist = existing.get(phash)
            if exist and exist.get("producer", "").strip() and exist.get("producer", "").strip() != "未知":
                continue
            rows_to_insert.append((
                phash, filename, asset_type, 0, creator, now_str, json.dumps({"canva_id": canva_id}), None
            ))
            
        if rows_to_insert:
            db.upsert_assets_bulk(rows_to_insert)
            
        if canva_id:
            db.add_canva_template(canva_id, template_name, creator, unique_hashes, "via local plugin")
            
        return jsonify({"success": True, "count": len(unique_hashes)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/app.js', methods=['GET'])
def serve_app_js():
    return send_from_directory(os.path.abspath('../dist'), 'app.js')

@app.route('/messages_en.json', methods=['GET'])
def serve_messages():
    return send_from_directory(os.path.abspath('../dist'), 'messages_en.json')

if __name__ == "__main__":
    app.run(port=8080, host="0.0.0.0")
