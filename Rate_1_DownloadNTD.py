import csv
import os
import re
import time
import requests
import urllib3

# 關閉 SSL 驗證警告[cite: 1]
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def fetch_page_data(page_num):
    # 抓取指定頁碼的匯率資料[cite: 1]
    url = f"https://www.cbc.gov.tw/tw/lp-645-1-{page_num}-60.html"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            " (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
            " Edg/145.0.0.0"
        )
    }

    page_data = []
    try:
        response = requests.get(url, headers=headers, verify=False, timeout=10)
        response.raise_for_status()
        html_text = response.text

        # 使用正規表示法撈取資料[cite: 1]
        pattern = re.compile(
            r'data-th="標題\(日期\)".*?<span>(.*?)</span>.*?data-th="NTD/USD".*?<span>(.*?)</span>',
            re.DOTALL,
        )
        matches = pattern.findall(html_text)

        for date, rate in matches:
            date_str = date.strip()
            rate_str = rate.strip()
            try:
                rate_val = float(rate_str)
            except ValueError:
                rate_val = rate_str
            page_data.append({"日期": date_str, "匯率": rate_val})

    except Exception as e:
        print(f" 錯誤：第 {page_num} 頁抓取失敗，原因：{e}")

    return page_data


def main():
    # ----------------- 自訂參數設定 -----------------
    start_page = 1  # 起始頁碼
    end_page = 1  # 結束頁碼

    # 設定路徑為當前 .py 所在的資料夾
    base_dir = os.path.dirname(os.path.abspath(__file__))
    output_filepath = os.path.join(base_dir, "rate_usd_ntd.csv")
    # -----------------------------------------------

    all_data = []
    print(f"正在開始抓取第 {start_page} 頁 到 第 {end_page} 頁的資料...")

    for page in range(start_page, end_page + 1):
        print(f"-> 正在爬取第 {page}/{end_page} 頁...", end="", flush=True)
        page_result = fetch_page_data(page)

        if page_result:
            all_data.extend(page_result)
            print(f" 成功 (取得 {len(page_result)} 筆)")
        else:
            print(" 失敗或無資料")

        time.sleep(0.5)

    if not all_data:
        print("未抓取到任何資料，程式結束。")
        return

    # ----------------- 讀取既有 CSV 整合資料 -----------------
    existing_data = {}

    # 若檔案已存在，先載入舊資料（以日期為 key 方便覆蓋或去重）
    if os.path.exists(output_filepath):
        with open(output_filepath, mode="r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            header = next(reader, None)  # 跳過表頭
            for row in reader:
                if len(row) >= 2:
                    existing_data[row[0].strip()] = row[1].strip()

    # 將新抓取的資料併入字典（若日期重複則以最新抓到的為準）
    new_count = 0
    for row in all_data:
        d = row["日期"]
        if d not in existing_data:
            new_count += 1
        existing_data[d] = row["匯率"]

    # 依日期由舊到新排序 (按日期升序)
    merged_data = sorted(existing_data.items(), key=lambda x: x[0])

    print(
        f"\n資料整併完畢！原先有 {len(existing_data) - new_count} 筆，本次新增 {new_count} 筆，總計 {len(merged_data)} 筆。"
    )

    # ----------------- 寫入 CSV 檔案 -----------------
    with open(output_filepath, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["date", "usd_ntd_rate"])

        for date_str, rate_val in merged_data:
            writer.writerow([date_str, rate_val])

    print(f"【成功儲存】檔案已更新：{output_filepath}")


if __name__ == "__main__":
    main()