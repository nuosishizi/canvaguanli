
import sys
import json
import os
import time

# 导入桌面上原来的 mam_db.py
sys.path.append(os.path.abspath(r"C:\Users\newnew\Desktop\素材管理"))
try:
    from mam_db import DBManager
except ImportError as e:
    print(f"Error importing mam_db: {e}", file=sys.stderr)
    sys.exit(1)

def main():
    if len(sys.argv) < 2:
        print("Usage: python register_db.py <json_payload_file>")
        sys.exit(1)

    json_filepath = sys.argv[1]
    with open(json_filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    creator = data.get("creator", "")
    canva_id = data.get("canvaId", "")
    template_name = data.get("templateName", "")
    canva_user_id = data.get("canvaUserId", "")
    canva_app_id = data.get("canvaAppId", "")
    canva_brand_id = data.get("canvaBrandId", "")
    assets = data.get("assets", [])

    if not assets:
        print("No assets to register.")
        return

    # 按 phash 去重并保留第一个有效文件
    unique_phash_map = {}
    for a in assets:
        h = a.get("hash")
        if h and h not in unique_phash_map:
            unique_phash_map[h] = a

    db = DBManager()
    db.connect()

    # (phash, filename, asset_type, file_size, producer, created_at, metadata_json, thumbnail)
    rows_to_insert = []
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")

    # 查询数据库中已有的素材信息
    existing_assets = db.get_assets_by_phashes(list(unique_phash_map.keys()))

    for h, a in unique_phash_map.items():
        # 如果数据库找到了这串 hash，且制作人不是未知/空，则跳过登记（不覆盖不登记只做后面的关联）
        existing_record = existing_assets.get(h)
        if existing_record:
            old_producer = existing_record.get("producer", "")
            if old_producer and old_producer.strip() != "未知":
                continue

        media_type = a.get("assetType", "image")
        filename = a.get("label", "unknown")
        
        row = (
            h,                  # phash
            filename,           # filename
            media_type,         # asset_type
            0,                  # file_size
            creator,            # producer
            now_str,            # created_at
            json.dumps(
                {
                    "canva_id": canva_id,
                    "canva_user_id": canva_user_id,
                    "canva_app_id": canva_app_id,
                    "canva_brand_id": canva_brand_id,
                },
                ensure_ascii=False,
            ),  # metadata_json
            None                # thumbnail
        )
        rows_to_insert.append(row)

    if rows_to_insert:
        db.upsert_assets_bulk(rows_to_insert)

    # 2. 注册模板关联
    if canva_id:
        phash_list = list(unique_phash_map.keys())
        db.add_canva_template(
            canva_id,
            template_name,
            creator,
            phash_list,
            f"via tool plugin; app={canva_app_id}; user={canva_user_id}",
        )

    print(f"Successfully registered {len(unique_phash_map)} unique assets.")

if __name__ == "__main__":
    main()

