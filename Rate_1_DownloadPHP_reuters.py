import os
import csv
import re
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

# =====================================================================
# 路徑與目標網址
# =====================================================================
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE = os.path.join(CURRENT_DIR, "rate_usd_php.csv")
TARGET_URL = "https://www.reuters.com/markets/quote/PHP=X/profile/"

# 儲存通過人機驗證後的 Cookie（沿用原本設定）
USER_DATA_DIR = os.path.join(CURRENT_DIR, "edge_profile")

# =====================================================================
# 可調參數
# =====================================================================
# quote time (UTC+0) 與當下時間差距超過此分鐘數時，視為過舊資料，
# 仍會寫入 CSV，但會在 note 欄位加註提示。
STALE_THRESHOLD_MINUTES = 40

# 本地時區（台灣 UTC+8），用於 crawled_at 欄位與差距比對顯示
LOCAL_TZ = timezone(timedelta(hours=8))

# CSV 欄位順序
CSV_HEADERS = ["date", "usd_php_rate", "crawled_at", "quote_time", "note"]


# =====================================================================
# CSV 工具
# =====================================================================
def ensure_csv_exists():
    """若 CSV 不存在，建立含表頭的空檔。"""
    if not os.path.exists(CSV_FILE):
        with open(CSV_FILE, mode="w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(CSV_HEADERS)
        print(f"已建立新的 CSV 檔：{CSV_FILE}")


def find_today_row(today_str):
    """檢查 CSV 中是否已有 date == today_str 的資料，回傳該列 dict 或 None。"""
    if not os.path.exists(CSV_FILE):
        return None
    with open(CSV_FILE, mode="r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("date", "").strip() == today_str:
                return row
    return None


def append_row(date_str, rate, crawled_at_str, quote_time_str, note):
    """以 append 模式新增一列，不動既有資料。"""
    with open(CSV_FILE, mode="a", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([date_str, rate, crawled_at_str, quote_time_str, note])


# =====================================================================
# quote time 解析
# =====================================================================
def parse_quote_time(raw_text):
    """
    從頁面上的 quote time 字串（例：'As of Sep 22, 2026 03:15 UTC+0'）
    解析成 timezone-aware datetime (UTC)。無法解析時回傳 None。
    """
    if not raw_text:
        return None
    m = re.search(
        r"([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})",
        raw_text,
    )
    if not m:
        return None
    month_str, day, year, hour, minute = m.groups()
    try:
        dt = datetime.strptime(
            f"{month_str} {day} {year} {hour}:{minute}",
            "%b %d %Y %H:%M",
        )
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc)


# =====================================================================
# 抓匯率
# =====================================================================
def fetch_rate_and_quote_time():
    """
    開瀏覽器抓一次 USD/PHP 匯率與 quote time。
    回傳 (rate: float, quote_dt_utc: datetime|None, quote_time_raw: str)。
    抓不到匯率則 raise RuntimeError。
    """
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            USER_DATA_DIR,
            channel="msedge",
            headless=False,
            args=["--start-maximized"],
            no_viewport=True,
        )
        page = context.new_page()
        page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60000)

        # 等匯率數字出現
        rate_locator = page.locator("span[data-testid='Price']").first
        rate_locator.wait_for(state="visible", timeout=60000)
        rate_text = rate_locator.inner_text().strip().replace(",", "")

        # 讀取 quote time 字串（含 'UTC+0'）
        quote_time_raw = ""
        try:
            qt_locator = page.locator("text=/UTC\\+0/").first
            qt_locator.wait_for(state="visible", timeout=10000)
            quote_time_raw = qt_locator.inner_text().strip()
        except Exception:
            quote_time_raw = ""

        context.close()

    try:
        rate = float(rate_text)
    except ValueError:
        raise RuntimeError(f"匯率解析失敗：{rate_text!r}")

    quote_dt_utc = parse_quote_time(quote_time_raw)
    return rate, quote_dt_utc, quote_time_raw


# =====================================================================
# 主程式
# =====================================================================
def main():
    ensure_csv_exists()

    now_local = datetime.now(LOCAL_TZ)
    today_str = now_local.strftime("%Y/%m/%d")

    # 1) 先看今日是否已有資料
    existing = find_today_row(today_str)
    if existing is not None:
        print(f"CSV 中已有今日 ({today_str}) 資料，依既有資料為準，不覆蓋。")
        print(
            "既有紀錄 -> "
            f"date: {existing.get('date','')} | "
            f"usd_php_rate: {existing.get('usd_php_rate','')} | "
            f"crawled_at: {existing.get('crawled_at','')} | "
            f"quote_time: {existing.get('quote_time','')} | "
            f"note: {existing.get('note','')}"
        )
        return

    # 2) 抓匯率
    print(f"開始抓取匯率：{TARGET_URL}")
    try:
        rate, quote_dt_utc, quote_time_raw = fetch_rate_and_quote_time()
    except Exception as e:
        print(f"抓取失敗：{e}")
        return

    rate_str = f"{rate:.4f}"
    crawled_at_str = now_local.strftime("%Y/%m/%d %H:%M:%S")

    # 3) quote time 差距檢查（只影響 note，不影響是否寫入）
    note = ""
    if quote_dt_utc is None:
        quote_time_str = quote_time_raw or ""
        note = "quote_time 無法解析"
        print(f"quote_time 無法解析，原始字串：{quote_time_raw!r}")
    else:
        quote_time_str = quote_dt_utc.strftime("%Y/%m/%d %H:%M:%S UTC+0")
        now_utc = datetime.now(timezone.utc)
        diff_minutes = abs((now_utc - quote_dt_utc).total_seconds()) / 60.0
        quote_local = quote_dt_utc.astimezone(LOCAL_TZ)

        print(f"quote_time (UTC+0) : {quote_dt_utc.strftime('%Y/%m/%d %H:%M:%S')}")
        print(f"quote_time (本地時間): {quote_local.strftime('%Y/%m/%d %H:%M:%S')}")
        print(f"當下時間 (本地時間): {now_local.strftime('%Y/%m/%d %H:%M:%S')}")
        print(f"差距分鐘數        : {diff_minutes:.1f} 分")

        if diff_minutes > STALE_THRESHOLD_MINUTES:
            note = (
                f"quote_time 與抓取時間差距 {diff_minutes:.1f} 分鐘，"
                f"超過 {STALE_THRESHOLD_MINUTES} 分鐘門檻"
            )
            print(f"⚠ {note}，仍寫入 CSV 並於 note 欄位標註。")

    # 4) 寫入 CSV
    append_row(today_str, rate_str, crawled_at_str, quote_time_str, note)
    print(
        "已寫入 CSV -> "
        f"date: {today_str} | usd_php_rate: {rate_str} | "
        f"crawled_at: {crawled_at_str} | quote_time: {quote_time_str} | "
        f"note: {note}"
    )


if __name__ == "__main__":
    main()
