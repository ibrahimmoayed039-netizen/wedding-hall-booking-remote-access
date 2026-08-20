@echo off
chcp 65001 >nul
title تجهيز مشروع أندرويد + مكتبة مسح QR (ML Kit)
echo ===============================================
echo   تجهيز مشروع الأندرويد وإضافة مكتبة الكاميرا
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

echo [1/4] تثبيت المكتبات (Capacitor + ML Kit) ...
call npm install
if %errorlevel% neq 0 (
    echo حدث خطأ أثناء تثبيت المكتبات. تأكد من اتصالك بالإنترنت وحاول مجدداً.
    pause
    exit /b
)

echo.
if exist android (
    echo [2/4] مجلد android موجود مسبقاً - تخطي الإنشاء.
) else (
    echo [2/4] إنشاء مشروع أندرويد الأصلي ...
    call npx cap add android
    if %errorlevel% neq 0 (
        echo حدث خطأ أثناء إنشاء مشروع أندرويد.
        pause
        exit /b
    )
)

echo.
echo [3/4] ربط مكتبة مسح QR (ML Kit) وإضافة صلاحية الكاميرا تلقائياً ...
call npx cap sync android
if %errorlevel% neq 0 (
    echo حدث خطأ أثناء ربط المكتبة.
    pause
    exit /b
)

echo.
echo [4/4] التحقق من صلاحية الكاميرا بملف AndroidManifest.xml ...
findstr /C:"android.permission.CAMERA" android\app\src\main\AndroidManifest.xml >nul
if %errorlevel% equ 0 (
    echo   ✔ صلاحية الكاميرا موجودة بنجاح.
) else (
    echo   ⚠ لم تُضف تلقائياً - سيتم إضافتها الآن يدوياً ...
    powershell -Command "(Get-Content 'android\app\src\main\AndroidManifest.xml') -replace '<application', '<uses-permission android:name=\"android.permission.CAMERA\" />`r`n    <application' | Set-Content 'android\app\src\main\AndroidManifest.xml'"
    echo   ✔ تمت إضافتها يدوياً.
)

echo.
echo ===============================================
echo   تم بنجاح! مشروع android جاهز ببصلاحية الكاميرا.
echo   الآن افتح مجلد android بـ Android Studio وابنِ
echo   الـ APK (Build ^> Build Bundle(s) / APK(s) ^> Build APK(s))
echo   أو استخدم GitHub Actions لو تبنيه بالسحابة.
echo ===============================================
pause
