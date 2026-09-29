# -*- coding: utf-8 -*-
"""
Rate_QuoteTime.py

於指定時段內每固定間隔監測 CNY / TWD 當日匯率，首次抓到即寫入同路徑的
rate_quote_time.csv（append，不覆蓋既有資料）。

CSV 欄位：date, currency, quote_time, rate
"""

import csv
import os
import re
import time
from datetime import date, datetime, time as dtime

import requests
import urllib3
from bs4 import BeautifulSoup
from dateutil.relativedelta import relativedelta

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ============================================================
# ☆ 參數設定（要改時間 / 間隔 只改這區）
# ============================================================
MONITOR_START = dtime(8, 0)     # 監測時段開始：08:00
MONITOR_END   = dtime(17, 0)    # 監測時段結束：17:00
POLL_INTERVAL_SEC = 10          # 監測間隔（秒）
# ============================================================

CSV_NAME = "rate_quote_time.csv"
CSV_HEADER = ["date", "currency", "quote_time", "rate"]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        " (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


# ============ 抓取函式 ============
def fetch_cny_today():
    """只回傳「今天」的 (date_str, rate_float)，否則 None。"""
    today = date.today()
    today_str = today.strftime("%Y-%m-%d")
    start_date = (today - relativedelta(months=1)).replace(day=1)

    url = "https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do"
    params = {
        "startDate": start_date.strftime("%Y-%m-%d"),
        "endDate": today_str,
        "query": "true",
    }
    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table", {"id": "InfoTable"}) or soup.find("table")
        if not table:
            return None
        for row in table.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) >= 2:
                d_text = cols[0].get_text(strip=True)
                rate_text = cols[1].get_text(strip=True)
                if d_text == today_str:
                    try:
                        # 原網頁為 100 美元兌人民幣，換算為 1 USD -> CNY
                        rate_per_usd = round(float(rate_text) / 100.0, 4)
                        return d_text, rate_per_usd
                    except ValueError:
                        return None
        return None
    except Exception as e:
        print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] [CNY] 抓取失敗：{e}")
        return None


def fetch_twd_today():
    """只回傳「今天」的 (date_str, rate_float)，否則 None。"""
    today = date.today()
    today_variants = {
        today.strftime("%Y-%m-%d"),
        today.strftime("%Y/%m/%d"),
    }
    url = "https://www.cbc.gov.tw/tw/lp-645-1-1-60.html"
    try:
        resp = requests.get(url, headers=HEADERS, verify=False, timeout=15)
        resp.raise_for_status()
        pattern = re.compile(
            r'data-th="標題\(日期\)".*?<span>(.*?)</span>'
            r'.*?data-th="NTD/USD".*?<span>(.*?)</span>',
            re.DOTALL,
        )
        matches = pattern.findall(resp.text)
        if not matches:
            return None
        for d_text, rate_text in matches:
            d_text = d_text.strip()
            rate_text = rate_text.strip()
            if d_text in today_variants:
                try:
                    d_norm = d_text.replace("/", "-")
                    return d_norm, float(rate_text)
                except ValueError:
                    return None
        return None
    except Exception as e:
        print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] [TWD] 抓取失敗：{e}")
        return None


# ============ CSV 工具 ============
def ensure_csv(csv_path):
    if not os.path.exists(csv_path):
        with open(csv_path, mode="w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f).writerow(CSV_HEADER)


def already_recorded(csv_path, target_date, currency):
    if not os.path.exists(csv_path):
        return False
    with open(csv_path, mode="r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if (row.get("date", "").strip() == target_date
                    and row.get("currency", "").strip().lower() == currency):
                return True
    return False


def append_record(csv_path, date_str, currency, quote_time_str, rate):
    with open(csv_path, mode="a", newline="", encoding="utf-8-sig") as f:
        csv.writer(f).writerow([date_str, currency, quote_time_str, rate])


# ============ 主流程 ============
def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(base_dir, CSV_NAME)
    ensure_csv(csv_path)

    start_dt = datetime.now()
    today_str = start_dt.strftime("%Y-%m-%d")

    # (1) 程式開始
    print(f"[{start_dt:%Y-%m-%d %H:%M:%S}] 程式啟動"
          f"；指定時段 {MONITOR_START.strftime('%H:%M')} ~ {MONITOR_END.strftime('%H:%M')}"
          f"；監聽間隔 {POLL_INTERVAL_SEC} 秒")

    # 本日已寫過就不重複抓
    cny_done = already_recorded(csv_path, today_str, "cny")
    twd_done = already_recorded(csv_path, today_str, "twd")

    entered_window = False  # 控制 「進入監測時段」 只印一次

    while True:
        now_dt = datetime.now()
        now_t = now_dt.time()

        # (4-a) 超出指定時間 → 結束
        if now_t > MONITOR_END:
            print(f"[{now_dt:%Y-%m-%d %H:%M:%S}] 超出指定時段 {MONITOR_END.strftime('%H:%M')}，停止監聽並結束程式。")
            break

        # (4-b) 兩幣別都已完成 → 結束
        if cny_done and twd_done:
            print(f"[{now_dt:%Y-%m-%d %H:%M:%S}] CNY / TWD 皆已監聽到當日匯率，停止監聽並結束程式。")
            break

        # 尚未進入監測時段 → sleep 到間隔後再確認
        if now_t < MONITOR_START:
            time.sleep(POLL_INTERVAL_SEC)
            continue

        # (2) 進入監測時段（只印一次）
        if not entered_window:
            print(f"[{now_dt:%Y-%m-%d %H:%M:%S}] 進入監測時段，開始輪詢 CNY / TWD 當日匯率。")
            entered_window = True

        # -------- CNY --------
        if not cny_done:
            result = fetch_cny_today()
            if result is not None:
                d_str, rate_val = result
                quote_time_str = now_dt.strftime("%Y-%m-%d %H:%M")
                if not already_recorded(csv_path, d_str, "cny"):
                    append_record(csv_path, d_str, "cny", quote_time_str, rate_val)
                    # (3) 首次抓到
                    print(f"[{now_dt:%Y-%m-%d %H:%M:%S}] [CNY] 首次抓到匯率 {rate_val}，寫入 CSV；停止監聽 CNY。")
                else:
                    print(f"[{now_dt:%Y-%m-%d %H:%M:%S}] [CNY] 今日已有紀錄，停止監聽 CNY。")
                cny_done = True

        # -------- TWD --------
        if not twd_done:
            result = fetch_twd_today()
            if result is not None:
                d_str, rate_val = result
                quote_time_str = now_dt.strftime("%Y-%m-%d %H:%M")
                if not already_recorded(csv_path, d_str, "twd"):
                    append_record(csv_path, d_str, "twd", quote_time_str, rate_val)
                    # (3) 首次抓到
                    print(f"[{now_dt:%Y-%m-%d %H:%M:%S}] [TWD] 首次抓到匯率 {rate_val}，寫入 CSV；停止監聽 TWD。")
                else:
                    print(f"[{now_dt:%Y-%m-%d %H:%M:%S}] [TWD] 今日已有紀錄，停止監聽 TWD。")
                twd_done = True

        # 兩幣別都完成 → 下一圈開頭會命中 (4-b) 結束
        if cny_done and twd_done:
            continue

        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
