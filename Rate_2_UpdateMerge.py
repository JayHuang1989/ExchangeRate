# -*- coding: utf-8 -*-
import csv
import os
import re
import calendar
from datetime import datetime

# ==================== 參數設定常數 ====================
START_YEAR_MONTH = "2016/01"  # 僅處理此年月(含)之後的折算匯率，格式: YYYY/MM
MONTH_END_BUFFER_DAYS = 3     # 最新月份距離日曆月底 N 天以內，才視為潛在月底日 (避免月中誤觸發)
# ====================================================


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
                if std_date and raw_rate.strip() != "":
                    rates[std_date] = raw_rate.strip()

    print(f"-> 成功讀取 {os.path.basename(filepath)}：共 {len(rates)} 筆有效日期資料")
    return rates


def read_existing_merged(filepath):
    """
    讀取既有的 rate_merge.csv，保留歷史合併資料
    格式：{ "yyyy/mm/dd": {"twd": rate, "cny": rate, "php": rate, "cny_twd": rate, "php_twd": rate, "note_cny": note} }
    """
    data = {}
    if not os.path.exists(filepath):
        return data

    with open(filepath, mode="r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader, None)

        for row in reader:
            if len(row) >= 1:
                std_date = standardize_date(row[0])
                if std_date:
                    twd_val = row[1].strip() if len(row) > 1 else ""
                    cny_val = row[2].strip() if len(row) > 2 else ""
                    php_val = row[3].strip() if len(row) > 3 else ""
                    cny_twd_val = row[4].strip() if len(row) > 4 else ""
                    php_twd_val = row[5].strip() if len(row) > 5 else ""
                    note_cny_val = row[6].strip() if len(row) > 6 else ""

                    data[std_date] = {
                        "twd": twd_val,
                        "cny": cny_val,
                        "php": php_val,
                        "cny_twd": cny_twd_val,
                        "php_twd": php_twd_val,
                        "note_cny": note_cny_val,
                    }

    print(f"-> 成功載入既有合併檔 {os.path.basename(filepath)}：共 {len(data)} 筆歷史資料")
    return data


def resolve_foreign_rate(target_date, foreign_records, is_cny=False, is_twd_month_end=False, allow_borrow=True):
    """
    依原則尋找外幣匯率：
    回傳 (匯率 float, 實際採用日期 str, 匯率原始字串 str)
    若無資料則回傳 (None, None, None)
    """
    curr_ym = target_date[:7]  # YYYY/MM

    # 原則 2: 僅 CNY 適用，遇 TWD 月底日強制採用該月 CNY 實際最後一個交易日
    if is_cny and is_twd_month_end:
        month_cny_dates = [d for d in foreign_records if d.startswith(curr_ym)]
        if month_cny_dates:
            month_cny_dates.sort()
            actual_date = month_cny_dates[-1]
            rate_str = foreign_records[actual_date]
            try:
                return float(rate_str), actual_date, rate_str
            except ValueError:
                return None, None, None

    # 當日即有資料
    if target_date in foreign_records:
        rate_str = foreign_records[target_date]
        try:
            return float(rate_str), target_date, rate_str
        except ValueError:
            pass

    # PHP 等不適用借調規則的幣別：找不到同日資料就直接回傳空，不往前後候接。
    if not allow_borrow:
        return None, None, None

    # 原則 1: 同月前日優先
    same_month_earlier = [
        d for d in foreign_records
        if d.startswith(curr_ym) and d < target_date
    ]
    if same_month_earlier:
        same_month_earlier.sort()
        actual_date = same_month_earlier[-1]
        rate_str = foreign_records[actual_date]
        try:
            return float(rate_str), actual_date, rate_str
        except ValueError:
            return None, None, None

    # 原則 1: 往前日已跨月，改同月後日遞補
    same_month_later = [
        d for d in foreign_records
        if d.startswith(curr_ym) and d > target_date
    ]
    if same_month_later:
        same_month_later.sort()
        actual_date = same_month_later[0]
        rate_str = foreign_records[actual_date]
        try:
            return float(rate_str), actual_date, rate_str
        except ValueError:
            return None, None, None

    return None, None, None


def main():
    # 設定路徑為當前腳本所在的資料夾
    base_dir = os.path.dirname(os.path.abspath(__file__))

    file_twd = os.path.join(base_dir, "rate_usd_twd.csv")
    file_cny = os.path.join(base_dir, "rate_usd_cny.csv")
    file_php = os.path.join(base_dir, "rate_usd_php.csv")
    file_merge = os.path.join(base_dir, "rate_merge.csv")

    print("=== 開始執行匯率資料合併作業 ===")

    # 1. 讀取現有合併檔 (保留歷史資料)
    merged_records = read_existing_merged(file_merge)
    existing_count = len(merged_records)

    # 2. 讀取 USD/TWD, USD/CNY 及 USD/PHP 最新資料
    twd_records = read_rate_file(file_twd)
    cny_records = read_rate_file(file_cny)
    php_records = read_rate_file(file_php)

    # 3. 收集所有出現過的日期 (聯集)
    all_dates = (
        set(merged_records.keys())
        | set(twd_records.keys())
        | set(cny_records.keys())
        | set(php_records.keys())
    )

    if not all_dates:
        print("未獲取任何匯率資料，程式結束。")
        return

    # 4. 更新/合併基礎匯率資料並追蹤變動
    has_changed = False
    new_added_count = 0

    for d in all_dates:
        if d not in merged_records:
            merged_records[d] = {
                "twd": "", "cny": "", "php": "",
                "cny_twd": "", "php_twd": "", "note_cny": ""
            }
            has_changed = True
            new_added_count += 1

        if d in twd_records and twd_records[d] != "":
            if merged_records[d].get("twd") != twd_records[d]:
                merged_records[d]["twd"] = twd_records[d]
                has_changed = True

        if d in cny_records and cny_records[d] != "":
            if merged_records[d].get("cny") != cny_records[d]:
                merged_records[d]["cny"] = cny_records[d]
                has_changed = True

        if d in php_records and php_records[d] != "":
            if merged_records[d].get("php") != php_records[d]:
                merged_records[d]["php"] = php_records[d]
                has_changed = True

    # 5. 建立有值的完整歷史字典供折算時尋找
    full_twd = {d: merged_records[d]["twd"] for d in merged_records if merged_records[d].get("twd", "") != ""}
    full_cny = {d: merged_records[d]["cny"] for d in merged_records if merged_records[d].get("cny", "") != ""}
    full_php = {d: merged_records[d]["php"] for d in merged_records if merged_records[d].get("php", "") != ""}

    # 找出所有 TWD 交易日並判定各月份最後一個 TWD 交易日
    twd_dates = sorted(full_twd.keys())
    twd_month_end_set = set()

    current_group_ym = None
    last_twd_date = None

    for d in twd_dates:
        ym = d[:7]
        if ym != current_group_ym:
            # 歷史月份：跨月時，上一月的最後一筆必定是月底日
            if last_twd_date:
                twd_month_end_set.add(last_twd_date)
            current_group_ym = ym
        last_twd_date = d

    # 針對「最新月份」的最後一筆資料進行 N 日判定
    if last_twd_date:
        dt = datetime.strptime(last_twd_date, "%Y/%m/%d")
        # 取得該月日曆天數 (例如 9 月有 30 天，cal_month_end 為 30)
        _, cal_month_end = calendar.monthrange(dt.year, dt.month)
        
        # 距離日曆月底的天數 (例如 9/30 為 0 天，9/28 為 2 天)
        days_to_calendar_end = cal_month_end - dt.day

        # 僅在進入月底緩衝天數內，才將當前最新資料視為月底日
        if days_to_calendar_end <= MONTH_END_BUFFER_DAYS:
            twd_month_end_set.add(last_twd_date)

    # 6. 計算折算匯率 (CNY:TWD, PHP:TWD) 與 note_cny
    for d in twd_dates:
        # 年月條件過濾：僅處理指定年月(含)之後的資料
        if d[:7] < START_YEAR_MONTH:
            continue

        try:
            usd_twd = float(full_twd[d])
        except ValueError:
            continue

        is_month_end = (d in twd_month_end_set)

        # ---------------- CNY:TWD 折算 ----------------
        cny_rate, cny_used_date, cny_raw_rate = resolve_foreign_rate(
            d, full_cny, is_cny=True, is_twd_month_end=is_month_end
        )
        new_cny_twd = ""
        new_note_cny = ""

        if cny_rate and cny_rate > 0:
            new_cny_twd = f"{(usd_twd / cny_rate):.8f}"
            # 若採用的日期非當日資料，註明借調資訊
            if cny_used_date != d:
                new_note_cny = f"{cny_used_date}@{cny_raw_rate}"

        if merged_records[d].get("cny_twd") != new_cny_twd:
            merged_records[d]["cny_twd"] = new_cny_twd
            has_changed = True

        if merged_records[d].get("note_cny") != new_note_cny:
            merged_records[d]["note_cny"] = new_note_cny
            has_changed = True

        # ---------------- PHP:TWD 折算 ----------------
        # PHP:TWD 僅採同日匯率，不適用月底日強採或候接規則
        php_rate, _, _ = resolve_foreign_rate(
            d, full_php, is_cny=False, is_twd_month_end=False, allow_borrow=False
        )
        new_php_twd = ""
        if php_rate and php_rate > 0:
            new_php_twd = f"{(usd_twd / php_rate):.8f}"

        if merged_records[d].get("php_twd") != new_php_twd:
            merged_records[d]["php_twd"] = new_php_twd
            has_changed = True

    # 7. 按日期 ascend (升序) 排序
    sorted_dates = sorted(merged_records.keys())
    total_count = len(sorted_dates)

    # 8. 依據是否有變動決定是否寫入檔案
    if has_changed:
        with open(file_merge, mode="w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            # 表頭新增 cny_twd, php_twd, note_cny
            writer.writerow(["date", "usd_twd", "usd_cny", "usd_php", "cny_twd", "php_twd", "note_cny"])

            for d in sorted_dates:
                writer.writerow([
                    d,
                    merged_records[d].get("twd", ""),
                    merged_records[d].get("cny", ""),
                    merged_records[d].get("php", ""),
                    merged_records[d].get("cny_twd", ""),
                    merged_records[d].get("php_twd", ""),
                    merged_records[d].get("note_cny", ""),
                ])

        print(f"【合併成功】既有資料 {existing_count} 筆，本次新增 {new_added_count} 筆，合併後 {total_count} 筆")
        print(f"折算匯率生效區間：{START_YEAR_MONTH} 起至最新資料")
        print(f"檔案已更新並儲存至：{file_merge}")
    else:
        print(f"【合併成功】既有資料 {existing_count} 筆，本次新增 {new_added_count} 筆，合併後 {total_count} 筆")
        print("目前皆為既有資料，無新增或異動，檔案未更新。")

    # 9. 結束前印出完成時間
    formatted_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"===== Merge 已執行完成 {formatted_time} =====\n")


if __name__ == "__main__":
    main()