@echo off
chcp 65001 >nul
title تشغيل نظام حجوزات القاعة
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [تنبيه] لم يتم العثور على Node.js على جهازك.
    echo الرجاء تثبيته أولاً من الموقع الرسمي: https://nodejs.org
    pause
    exit /b
)
echo جاري تجهيز البرنامج لأول مرة (قد يستغرق دقيقة)...
call npm install
call npm start
pause
