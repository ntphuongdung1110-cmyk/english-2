/* Cấu hình Supabase — điền 2 giá trị từ project của bạn rồi lưu lại.
   Lấy ở: Supabase → Project Settings → API
     - Project URL        → dán vào SUPABASE_URL
     - Project API keys → anon public  → dán vào SUPABASE_ANON_KEY
   anon key là khóa CÔNG KHAI dành cho web (an toàn để đặt ở đây vì đã có
   Row Level Security: mỗi người chỉ đọc/ghi được dữ liệu của chính mình).
   Nếu để nguyên placeholder, app vẫn chạy bình thường nhưng KHÔNG đồng bộ. */
window.SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
