import csv
import os
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# ================= 檔案與環境參數設定 =================
SOURCE_CSV_FILENAME = "rate_usd_twd.csv"  # 來源 CSV 檔名
TARGET_YEAR = "2010"                      # 想要篩選並轉置的年度
OUTPUT_EXCEL_FILENAME = f"{TARGET_YEAR}年度匯率表.xlsx"  # 匯出 Excel 檔名
# ====================================================

# 取得目前 .py 檔所在的絕對路徑
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE_CSV_PATH = os.path.join(BASE_DIR, SOURCE_CSV_FILENAME)
OUTPUT_EXCEL_PATH = os.path.join(BASE_DIR, OUTPUT_EXCEL_FILENAME)


def main():
    if not os.path.exists(SOURCE_CSV_PATH):
        print(f"找不到原始檔案：{SOURCE_CSV_PATH}，請確認檔案是否存在於同目錄。")
        return

    # 1. 讀取 CSV 資料並篩選指定年度
    # 資料結構設計：data_dict[month][day] = rate
    data_dict = {m: {} for m in range(1, 13)}

    with open(SOURCE_CSV_PATH, mode="r", encoding="utf-8-sig") as csv_file:
        reader = csv.reader(csv_file)
        header = next(reader, None)  # 跳過第一代表頭

        for row in reader:
            if len(row) < 2:
                continue
            date_val, rate_val = row[0].strip(), row[1].strip()

            # 檢查是否為目標年度
            if date_val.startswith(TARGET_YEAR):
                try:
                    # 支援 YYYY/MM/DD 或 YYYY-MM-DD 格式
                    delimiter = "/" if "/" in date_val else "-"
                    parts = date_val.split(delimiter)
                    if len(parts) == 3:
                        m = int(parts[1])
                        d = int(parts[2])
                        data_dict[m][d] = float(rate_val)
                except ValueError:
                    pass  # 忽略解析錯誤或非數值欄位

    # 2. 計算每個月的「最後一個交易日」
    last_trading_days = {}
    for m in range(1, 13):
        if data_dict[m]:
            last_trading_days[m] = max(data_dict[m].keys())
        else:
            last_trading_days[m] = None

    # 3. 建立新的 Excel 工作簿與 Sheet
    wb = openpyxl.Workbook()
    ws_new = wb.active
    sheet_title = f"{TARGET_YEAR}年年度匯率表"
    ws_new.title = sheet_title
    ws_new.views.sheetView[0].showGridLines = True

    # 4. 定義樣式與顏色
    font_header = Font(name="Microsoft JhengHei", size=10, bold=True, color="FFFFFF")
    font_data = Font(name="Microsoft JhengHei", size=10)

    fill_header = PatternFill(start_color="3A6073", end_color="3A6073", fill_type="solid")  # 莫蘭迪藍表頭
    fill_has_data = PatternFill(start_color="FFFFCC", end_color="FFFFCC", fill_type="solid")  # 淡黃色底
    fill_last_day = PatternFill(start_color="FABF8F", end_color="FABF8F", fill_type="solid")  # 橘色底

    align_center = Alignment(horizontal="center", vertical="center")
    align_right = Alignment(horizontal="right", vertical="center")

    thin_side = Side(style="thin", color="D0D5DD")
    border_normal = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    # 不存在日子的斜線樣式
    border_diagonal = Border(
        left=thin_side,
        right=thin_side,
        top=thin_side,
        bottom=thin_side,
        diagonal=Side(style="thin", color="B0B0B0"),
        diagonalUp=True,
        diagonalDown=True,
    )

    # 5. 寫入表頭 (Col A 為標籤，Col B~M 為 Jan.~Dec.)
    months_labels = [
        "Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.",
        "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."
    ]
    ws_new["A1"] = "Day / Month"
    ws_new["A1"].font = font_header
    ws_new["A1"].fill = fill_header
    ws_new["A1"].alignment = align_center
    ws_new["A1"].border = border_normal

    for m_idx, label in enumerate(months_labels, start=2):
        cell = ws_new.cell(row=1, column=m_idx, value=label)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_normal

    # 月份天數檢查表（判斷非閏年 / 閏年天數）
    year_int = int(TARGET_YEAR)
    is_leap = (year_int % 4 == 0 and year_int % 100 != 0) or (year_int % 400 == 0)
    days_in_month = {
        1: 31, 2: 29 if is_leap else 28, 3: 31, 4: 30, 5: 31, 6: 30,
        7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31
    }

    # 6. 開始填入 1~31 日的資料與繪製樣式
    for day in range(1, 32):
        row_idx = day + 1
        ws_new.row_dimensions[row_idx].height = 22

        # 寫入第一欄的日期 (1, 2, 3...31)
        cell_day_label = ws_new.cell(row=row_idx, column=1, value=day)
        cell_day_label.font = Font(name="Microsoft JhengHei", size=10, bold=True)
        cell_day_label.alignment = align_center
        cell_day_label.border = border_normal

        # 填入 1~12 月的匯率
        for month in range(1, 13):
            col_idx = month + 1
            cell = ws_new.cell(row=row_idx, column=col_idx)
            cell.font = font_data
            cell.border = border_normal

            # A. 判斷是否為「不存在的日子」
            if day > days_in_month[month]:
                cell.value = ""
                cell.border = border_diagonal
                continue

            # B. 判斷是否有匯率交易資料
            rate = data_dict[month].get(day)
            if rate is not None:
                cell.value = rate
                cell.number_format = "0.000"
                cell.alignment = align_right

                # C. 判斷是否為該月「最後一個交易日」
                if day == last_trading_days[month]:
                    cell.fill = fill_last_day
                else:
                    cell.fill = fill_has_data
            else:
                # 該月份存在這一天，但當天為假日/無交易
                cell.value = ""
                cell.alignment = align_center

    # 7. 自動調整欄寬與凍結窗格
    ws_new.column_dimensions["A"].width = 14
    for col in range(2, 14):
        col_letter = get_column_letter(col)
        ws_new.column_dimensions[col_letter].width = 10

    ws_new.row_dimensions[1].height = 26
    ws_new.freeze_panes = "B2"

    # 8. 儲存檔案
    wb.save(OUTPUT_EXCEL_PATH)
    print(f"轉置完成！已成功將資料匯出至：{OUTPUT_EXCEL_PATH}")


if __name__ == "__main__":
    main()