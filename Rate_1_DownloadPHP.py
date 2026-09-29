import os
import csv
from datetime import datetime, time as dtime, timezone, timedelta

# =====================================================================
# 路徑設定
# =====================================================================
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE_CSV = os.path.join(CURRENT_DIR, "rate_usd_php_all.csv")
TARGET_CSV = os.path.join(CURRENT_DIR, "rate_usd_php.csv")

LOCAL_TZ = timezone(timedelta(hours=8))
STALE_THRESHOLD_MINUTES = 40
CSV_HEADERS = ["date", "usd_php_rate", "crawled_at", "quote_time", "note"]
TARGET_BENCHMARK_TIME = dtime(10, 0, 0)


def ensure_target_csv_exists():
    """若目標 CSV 不存在，建立含表頭的空檔。"""
    if not os.path.exists(TARGET_CSV):
        with open(TARGET_CSV, mode="w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(CSV_HEADERS)
        print(f"已建立新的目標 CSV 檔：{TARGET_CSV}")


def has_today_record(today_str):
    """檢查目標 CSV 是否已存在當日紀錄。"""
    if not os.path.exists(TARGET_CSV):
        return False
    with open(TARGET_CSV, mode="r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("date", "").strip() == today_str:
                return True
    return False


def parse_source_quote_time(quote_time_str):
    """解析來源 CSV 的 quote_time (格式: 'YYYY/MM/DD HH:MM UTC') 為 UTC datetime 物件。"""
    if not quote_time_str or quote_time_str == "N/A":
        return None
    try:
        clean_str = quote_time_str.replace(" UTC", "").strip()
        dt = datetime.strptime(clean_str, "%Y/%m/%d %H:%M")
        return dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def find_10am_row_from_all(today_str):
    """從 24H CSV 中找出當天第一筆 >= 10:00:00 的紀錄。"""
    if not os.path.exists(SOURCE_CSV):
        print(f"找不到來源資料檔：{SOURCE_CSV}")
        return None

    candidate = None
    with open(SOURCE_CSV, mode="r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            date_col = row.get("date", "").strip()
            if not date_col:
                continue

            try:
                # 來源 date 欄位格式: "YYYY/MM/DD HH:MM:SS"
                row_dt = datetime.strptime(date_col, "%Y/%m/%d %H:%M:%S")
            except ValueError:
                continue

            # 僅比對當日資料
            if row_dt.strftime("%Y/%m/%d") == today_str:
                if row_dt.time() >= TARGET_BENCHMARK_TIME:
                    candidate = row
                    break  # 找到當天 10:00 之後的第一筆即離開

    return candidate


def main():
    ensure_target_csv_exists()

    now_local = datetime.now(LOCAL_TZ)
    today_str = now_local.strftime("%Y/%m/%d")

    # 1. 檢查目標檔是否已有當天資料
    if has_today_record(today_str):
        print(f"[{today_str}] 目標 CSV 已有今日基準匯率，跳過不重複寫入。")
        return

    # 2. 從 24H CSV 撈取 10:00 基準資料
    row = find_10am_row_from_all(today_str)
    if not row:
        print(f"[{today_str}] 尚未在 {SOURCE_CSV} 找到 10:00 之後的資料（請確認監控程式是否正常運行）。")
        return

    fetch_time_str = row.get("date", "").strip()
    rate = row.get("usd_php", "").strip()
    raw_quote_time = row.get("quote_time", "").strip()

    # 格式化數值保留 4 位小數
    try:
        rate_formatted = f"{float(rate):.4f}"
    except ValueError:
        rate_formatted = rate

    # 3. 檢查報價延遲（Note 邏輯），保持原字串格式 YYYY/MM/DD HH:MM UTC
    note = ""
    quote_dt_utc = parse_source_quote_time(raw_quote_time)
    
    if quote_dt_utc is None:
        note = "quote_time 無法解析或為 N/A"
    else:
        try:
            fetch_dt = datetime.strptime(fetch_time_str, "%Y/%m/%d %H:%M:%S").replace(tzinfo=LOCAL_TZ)
            diff_minutes = abs((fetch_dt - quote_dt_utc.astimezone(LOCAL_TZ)).total_seconds()) / 60.0
            if diff_minutes > STALE_THRESHOLD_MINUTES:
                note = f"quote_time 與抓取時間差距 {diff_minutes:.1f} 分鐘，超過 {STALE_THRESHOLD_MINUTES} 分鐘門檻"
        except Exception:
            pass

    # 4. 寫入目標檔案（quote_time 直接使用來源的 raw_quote_time）
    with open(TARGET_CSV, mode="a", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([today_str, rate_formatted, fetch_time_str, raw_quote_time, note])

    # Terminal 顯示同樣維持原格式
    print(
        f"基準匯率已成功寫入 -> "
        f"日期: {today_str} | "
        f"匯率: {rate_formatted} | "
        f"抓取時間: {fetch_time_str} | "
        f"資料時間: {raw_quote_time} | "
        f"備註: {note}"
    )


if __name__ == "__main__":
    main()