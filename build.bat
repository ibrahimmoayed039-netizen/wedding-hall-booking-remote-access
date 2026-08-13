@echo off
chcp 65001 >nul
title بناء نظام حجوزات القاعة
echo ===============================================
echo   جاري تجهيز وبناء البرنامج - الرجاء الانتظار
echo ===============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [تنبيه] لم يتم العثور على Node.js على جهازك.
    echo الرجاء تثبيته أولاً من الموقع الرسمي: https://nodejs.org
    echo ثم أعد تشغيل هذا الملف.
    pause
    exit /b
)

echo [1/2] تثبيت المكتبات المطلوبة ...
call npm install
if %errorlevel% neq 0 (
    echo حدث خطأ أثناء تثبيت المكتبات. تأكد من اتصالك بالإنترنت وحاول مجدداً.
    pause
    exit /b
)

echo.
echo [2/2] بناء ملف التثبيت (exe) ...
call npm run build
if %errorlevel% neq 0 (
    echo حدث خطأ أثناء البناء.
    pause
    exit /b
)

echo.
echo ===============================================
echo   تم الانتهاء بنجاح! سيتم فتح مجلد الملف الناتج
echo   ابحث عن ملف الإعداد (Setup) بامتداد exe
echo ===============================================
start dist
pause
