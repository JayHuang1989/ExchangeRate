import os
import csv
import time
import re
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE = os.path.join(CURRENT_DIR, "rate_usd_php_all.csv")
TARGET_URL = "https://www.reuters.com/markets/quote/PHP=X/profile/"

# 設定檔儲存目錄（儲存通過人機驗證後的 Cookie）
USER_DATA_DIR = os.path.join(CURRENT_DIR, "edge_profile")

# 抓取間隔時間 (秒)
INTERVAL_SECONDS = 30

# =====================================================================
# 單次排程最長運行時間設定 (例如: 23 小時 58 分鐘後自動優雅退出)
# =====================================================================
MAX_RUN_HOURS = 23
MAX_RUN_MINUTES = 58
TOTAL_RUN_DURATION = timedelta(hours=MAX_RUN_HOURS, minutes=MAX_RUN_MINUTES)


def init_csv():
    if not os.path.exists(CSV_FILE):
        with open(CSV_FILE, mode="w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["date", "usd_php", "quote_time"])


def get_last_quote_time():
    """讀取 CSV 最後一筆資料的 quote_time；若無資料則回傳 None。"""
    if not os.path.exists(CSV_FILE):
        return None
    try:
        with open(CSV_FILE, mode="r", encoding="utf-8-sig") as f:
            reader = list(csv.reader(f))
            if len(reader) > 1:
                last_row = reader[-1]
                if len(last_row) >= 3:
                    return last_row[2].strip()
    except Exception as e:
        print(f">>> 讀取歷史資料比對時發生異常: {e}")
    return None


def append_to_csv(fetch_time_str, rate, quote_time_str):
    with open(CSV_FILE, mode="a", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([fetch_time_str, rate, quote_time_str])


def parse_quote_time(raw_text):
    """解析並標準化資料時間為 yyyy/mm/dd hh:mm UTC"""
    if not raw_text:
        return "N/A"

    match = re.search(
        r'as of\s+([A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*UTC)',
        raw_text,
        re.IGNORECASE,
    )
    if not match:
        match = re.search(
            r'([A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*UTC)',
            raw_text,
            re.IGNORECASE,
        )

    if match:
        raw_dt = match.group(1).strip()
        # \s+ 自動涵蓋換行 (\r, \n)、Tab (\t) 與連續空白
        clean_str = re.sub(r'\s+', ' ', raw_dt).replace(',', '').replace('.', '')

        formats = [
            "%b %d %Y %I:%M %p UTC",
            "%b %d %Y %H:%M UTC",
            "%B %d %Y %I:%M %p UTC",
            "%b %d %Y %I:%M:%S %p UTC",
        ]
        for fmt in formats:
            try:
                dt = datetime.strptime(clean_str, fmt)
                return dt.strftime("%Y/%m/%d %H:%M UTC")
            except ValueError:
                continue

    return "N/A"


def extract_rate_and_quote_time(page):
    selector = "fwcx-quote-price-text span"

    try:
        page.wait_for_selector(selector, timeout=8000)
    except Exception:
        print(">>> 偵測到驗證頁或載入延遲，若畫面上出現「向右滑動」請在瀏覽器中手動完成驗證...")
        page.wait_for_selector(selector, timeout=60000)

    # 1. 擷取匯率數值
    rate = None
    elements = page.locator(selector).all()
    for el in elements:
        raw_text = el.inner_text().strip()
        match = re.search(r'\d+(?:\.\d+)?', raw_text)
        if match:
            rate = match.group(0)
            break

    if not rate:
        fallback = page.locator("div[class*='PriceContainer'] span, div[class*='QuotePrice'] span").first
        raw_fallback = fallback.inner_text().strip()
        match = re.search(r'\d+(?:\.\d+)?', raw_fallback)
        if match:
            rate = match.group(0)

    if not rate:
        raise ValueError("未能解析出數值格式的匯率")

    # 2. 精準定位擷取資料時間 (特定容器 + 明確等待 + Regex 提取)
    quote_time = "N/A"
    raw_time_text = ""
    try:
        as_of_locator = page.locator('span[data-test="as-of"]')
        as_of_locator.wait_for(timeout=5000)
        raw_time_text = as_of_locator.text_content() or as_of_locator.inner_text()
        quote_time = parse_quote_time(raw_time_text)
    except Exception:
        try:
            fallback_locator = page.locator("text=/Delayed quote/i").first
            fallback_locator.wait_for(timeout=3000)
            raw_time_text = fallback_locator.text_content() or fallback_locator.inner_text()
            quote_time = parse_quote_time(raw_time_text)
        except Exception as e2:
            print(f">>> 資料時間定位失敗: {e2}")

    if quote_time == "N/A" and raw_time_text:
        print(f">>> 提示：有抓到時間標籤，但格式未匹配，標籤內容為: '{raw_time_text}'")

    return rate, quote_time


def main():
    init_csv()
    start_time = datetime.now()
    end_target_time = start_time + TOTAL_RUN_DURATION

    print(f"[{start_time.strftime('%Y/%m/%d %H:%M:%S')}] 啟動 Reuters USD/PHP 匯率監控。")
    print(f"預計運行時長: {TOTAL_RUN_DURATION}，預計結束時間: {end_target_time.strftime('%Y/%m/%d %H:%M:%S')}")
    print(f"抓取頻率: 每 {INTERVAL_SECONDS} 秒，輸出檔案: {CSV_FILE}")

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            channel="msedge",
            headless=False,
            viewport={"width": 1366, "height": 768},
            args=[
                "--disable-blink-features=AutomationControlled",
                "--ignore-certificate-errors",
            ],
        )

        try:
            page = context.pages[0] if context.pages else context.new_page()

            while True:
                now = datetime.now()

                # 檢查是否達到運行時間上限
                if now >= end_target_time:
                    print(f"[{now.strftime('%Y/%m/%d %H:%M:%S')}] 已達到預定運行時間，執行安全關閉以重置環境...")
                    break

                date_str = now.strftime("%Y/%m/%d %H:%M:%S")

                try:
                    page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60000)
                    rate, quote_time = extract_rate_and_quote_time(page)

                    last_quote = get_last_quote_time()
                    if quote_time != "N/A" and last_quote is not None and quote_time == last_quote:
                        print(f"[{date_str}] 資料時間未更新 ({quote_time})，略過寫入。")
                    else:
                        append_to_csv(date_str, rate, quote_time)
                        if last_quote is None:
                            print(f"[{date_str}] 首筆資料寫入 -> 匯率: {rate} | 資料時間: {quote_time}")
                        else:
                            print(f"[{date_str}] 偵測到資料時間更新 -> 匯率: {rate} | 資料時間: {quote_time} (已寫入 CSV)")

                except Exception as e:
                    print(f"[{date_str}] 抓取失敗: {e}")

                time.sleep(INTERVAL_SECONDS)

        except KeyboardInterrupt:
            print("\n使用者中斷程式 (Ctrl+C)，正在安全關閉瀏覽器...")
        finally:
            print("正在關閉 Playwright Persistent Context 與瀏覽器...")
            context.close()
            print("瀏覽器已安全關閉，排程行程結束。")


if __name__ == "__main__":
    main()