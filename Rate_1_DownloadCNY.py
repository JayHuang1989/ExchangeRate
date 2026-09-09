import csv
from datetime import date
from dateutil.relativedelta import relativedelta
import os
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

    if os.path.exists(csv_file):
        df_old = pd.read_csv(csv_file)
        # 合併後依 date 欄位去重（保留最新抓取到的資料）
        df_merged = pd.concat([df_old, df_new]).drop_duplicates(
            subset=["date"], keep="last"
        )
    else:
        df_merged = df_new

    # 依日期由小到大排序
    df_merged = df_merged.sort_values(by="date", ascending=True)
    df_merged.to_csv(csv_file, index=False, encoding="utf-8-sig")

    print(
        f"更新成功！目前 CSV 共有 {len(df_merged)} 筆資料，已儲存至 {csv_file}"
    )


if __name__ == "__main__":
    get_usd_cny_rates()