# -*- coding: utf-8 -*-
import csv
import os
import re
from datetime import datetime


def standardize_date(date_str):
    """
    將不同格式的日期 (如 yyyy-mm-dd, yyyy/mm/dd, yyyy-m-d 等)
    統一轉換為 yyyy/mm/dd 格式的字串。
    若無法解析則回傳 None。
    """
    if not date_str:
        return None
    cleaned = date_str.strip()

    # 嘗試常見的日期格式
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d"):
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.strftime("%Y/%m/%d")
        except ValueError:
            pass

    # 備用正規表示法解析 (應對個位數月份或日期，如 2024/1/5 或 2024-1-5)
    match = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", cleaned)
    if match:
        year, month, day = match.groups()
        return f"{int(year):04d}/{int(month):02d}/{int(day):02d}"

    return None


def read_rate_file(filepath):
    """
    讀取匯率 CSV 檔，回傳 { "yyyy/mm/dd": rate_value } 的字典
    """
    rates = {}
    if not os.path.exists(filepath):
        print(f"⚠️ 提示：找不到檔案 {filepath}，將略過該檔案讀取。")
        return rates

    # 使用 utf-8-sig 兼顧有無 BOM
    with open(filepath, mode="r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader, None)  # 跳過表頭

        for row in reader:
            if len(row) >= 2:
                raw_date = row[0]
                raw_rate = row[1]
                std_date = standardize_date(raw_date)
                if std_date:
                    rates[std_date] = raw_rate.strip()

    print(f"-> 成功讀取 {os.path.basename(filepath)}：共 {len(rates)} 筆有效日期資料")
    return rates


def read_existing_merged(filepath):
    """
    讀取既有的 rate_merge.csv，保留歷史合併資料
    格式：{ "yyyy/mm/dd": {"ntd": rate, "cny": rate} }
    """
    data = {}
    if not os.path.exists(filepath):
        return data

    with open(filepath, mode="r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader, None)  # 表頭：date, usd_ntd, usd_cny

        for row in reader:
            if len(row) >= 1:
                std_date = standardize_date(row[0])
                if std_date:
                    ntd_val = row[1].strip() if len(row) > 1 else ""
                    cny_val = row[2].strip() if len(row) > 2 else ""
                    data[std_date] = {"ntd": ntd_val, "cny": cny_val}

    print(f"-> 成功載入既有合併檔 {os.path.basename(filepath)}：共 {len(data)} 筆歷史資料")
    return data


def main():
    # 設定路徑為當前腳本所在的資料夾
    base_dir = os.path.dirname(os.path.abspath(__file__))

    file_ntd = os.path.join(base_dir, "rate_usd_ntd.csv")
    file_cny = os.path.join(base_dir, "rate_usd_cny.csv")
    file_merge = os.path.join(base_dir, "rate_merge.csv")

    print("=== 開始執行匯率資料合併作業 ===")

    # 1. 讀取現有合併檔 (保留歷史資料)
    merged_records = read_existing_merged(file_merge)

    # 2. 讀取 USD/NTD 及 USD/CNY 最新資料
    ntd_records = read_rate_file(file_ntd)
    cny_records = read_rate_file(file_cny)

    # 3. 收集所有出現過的日期 (聯集)
    all_dates = set(merged_records.keys()) | set(ntd_records.keys()) | set(cny_records.keys())

    if not all_dates:
        print("未獲取任何匯率資料，程式結束。")
        return

    # 4. 更新/合併資料 (新資料覆蓋或填補舊資料)
    for d in all_dates:
        if d not in merged_records:
            merged_records[d] = {"ntd": "", "cny": ""}

        # 若新讀入的資料有值，則更新
        if d in ntd_records and ntd_records[d] != "":
            merged_records[d]["ntd"] = ntd_records[d]
        if d in cny_records and cny_records[d] != "":
            merged_records[d]["cny"] = cny_records[d]

    # 5. 按日期 ascend (升序) 排序：因為格式統一為 yyyy/mm/dd，可以直接做字串排序
    sorted_dates = sorted(merged_records.keys())

    # 6. 輸出至 rate_merge.csv
    with open(file_merge, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        # 表頭：日期 (yyyy/mm/dd)、美元兌台幣、美元兌人民幣
        writer.writerow(["date", "usd_ntd", "usd_cny"])

        for d in sorted_dates:
            writer.writerow([
                d,
                merged_records[d]["ntd"],
                merged_records[d]["cny"]
            ])

    print(f"【合併成功】共整合 {len(sorted_dates)} 筆日期資料！")
    print(f"檔案已儲存至：{file_merge}")


if __name__ == "__main__":
    main()
