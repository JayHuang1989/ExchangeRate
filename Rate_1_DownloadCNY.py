import csv
from datetime import date
from dateutil.relativedelta import relativedelta
import os
import time
from bs4 import BeautifulSoup
import pandas as pd
import requests


def get_usd_cny_rates():
    # 1. 計算日期範圍：上個月 1 號 ~ 今日
    today = date.today()
    start_date = (today - relativedelta(months=1)).replace(day=1)

    start_str = start_date.strftime("%Y-%m-%d")
    end_str = today.strftime("%Y-%m-%d")
    print(f"擷取區間: {start_str} 至 {end_str}")

    # 2. 請求網頁資料
    url = "https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do"
    params = {"startDate": start_str, "endDate": end_str, "query": "true"}
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            " (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }

    resp = requests.get(url, params=params, headers=headers, timeout=15)
    resp.encoding = "utf-8"

    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.find("table", {"id": "InfoTable"}) or soup.find("table")

    if not table:
        print("未找到匯率表格，請檢查網頁回應或連線狀況。")
        return

    # 3. 解析表格：第 1 欄為日期，第 2 欄為美元匯率（100 美元兌 RMB）
    rows = table.find_all("tr")
    new_data = []

    for row in rows:
        cols = row.find_all("td")
        if len(cols) >= 2:
            d_text = cols[0].get_text(strip=True)
            rate_text = cols[1].get_text(strip=True)

            # 驗證是否為有效日期格式 (YYYY-MM-DD)
            if len(d_text) == 10 and d_text.count("-") == 2:
                try:
                    # 網頁給出的是 100 美元兌人民幣，轉為 1 美元兌 RMB
                    rate_per_usd = round(float(rate_text) / 100.0, 4)
                    new_data.append(
                        {"date": d_text, "usd_cny_rate": rate_per_usd}
                    )
                except ValueError:
                    continue

    if not new_data:
        print("未取得任何新資料。")
        return

    df_new = pd.DataFrame(new_data)

    # 4. 取得當前 .py 檔案所在目錄，並鎖定 CSV 路徑
    current_dir = os.path.dirname(os.path.abspath(__file__))
    csv_file = os.path.join(current_dir, "rate_usd_cny.csv")

    original_count = 0
    new_count = 0
    updated = False

    if os.path.exists(csv_file):
        df_old = pd.read_csv(csv_file)
        original_count = len(df_old)

        # 比對新舊資料以計算實際新增/變動筆數
        merged_check = pd.merge(
            df_new, df_old, on="date", how="left", suffixes=("_new", "_old")
        )
        new_dates = merged_check[merged_check["usd_cny_rate_old"].isna()]
        updated_rates = merged_check[
            ~merged_check["usd_cny_rate_old"].isna()
            & (
                merged_check["usd_cny_rate_new"]
                != merged_check["usd_cny_rate_old"]
            )
        ]
        new_count = len(new_dates) + len(updated_rates)

        if new_count > 0:
            df_merged = pd.concat([df_old, df_new]).drop_duplicates(
                subset=["date"], keep="last"
            )
            df_merged = df_merged.sort_values(by="date", ascending=True)
            df_merged.to_csv(csv_file, index=False, encoding="utf-8-sig")
            updated = True
        else:
            df_merged = df_old
    else:
        df_merged = df_new
        new_count = len(df_new)
        df_merged = df_merged.sort_values(by="date", ascending=True)
        df_merged.to_csv(csv_file, index=False, encoding="utf-8-sig")
        updated = True

    total_count = len(df_merged)
    latest_date = df_merged["date"].max() if not df_merged.empty else "無"

    # 顯示終端機統計資訊
    print(
        f"CSV原有資料筆數: {original_count} 筆，本次新增 {new_count} 筆，新增後 {total_count} 筆，最新資料為 {latest_date}。"
    )

    if updated:
        print(f"更新成功！已儲存至 {csv_file}")
    else:
        print("【提示】沒有發現新資料，CSV 檔案保持不變，未進行覆寫。")

    # 顯示終端機統計資訊 (使用 time 模組)
    formatted_time = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    print(f"===== Download CNY 已執行完成 {formatted_time} =====\n")

if __name__ == "__main__":
    get_usd_cny_rates()