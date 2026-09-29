@echo off
@REM 設定編碼為 UTF-8
chcp 65001 > nul

cd /d "D:\JAY_CODE\python\ExchangeRate"

echo.
echo ========================================
echo [BATCH START] %date% %time%

echo 1. Downloading rates ...
python Rate_1_DownloadCNY.py
python Rate_1_DownloadTWD.py

echo 2. Merging rates ...
python Rate_2_UpdateMerge.py

echo 3. Git add, commit and push ...
git reset
git add rate_usd_twd.csv rate_usd_cny.csv rate_usd_php.csv rate_merge.csv
git commit --amend --no-edit
git push origin main --force-with-lease

echo [BATCH FINISHED] %date% %time%
echo ========================================
echo.