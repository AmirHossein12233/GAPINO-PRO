# GAPINO Chat Pro UI

این بسته فقط فایل‌های رابط صفحه اصلی چت را ارتقا می‌دهد و با API فعلی GAPINO-PRO هماهنگ شده است.

فایل‌ها را در پوشه `frontend` پروژه اصلی جایگزین کنید:
- chat.html
- app.js
- style.css

سپس سرور فعلی را دوباره اجرا کنید:

python -m uvicorn main:app --host 0.0.0.0 --port 8000
