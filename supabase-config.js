/* Cấu hình Supabase — điền 2 giá trị từ project của bạn rồi lưu lại.
   Lấy ở: Supabase → Project Settings → API
     - Project URL        → dán vào SUPABASE_URL
     - Project API keys → anon public  → dán vào SUPABASE_ANON_KEY
   anon key là khóa CÔNG KHAI dành cho web (an toàn để đặt ở đây vì đã có
   Row Level Security: mỗi người chỉ đọc/ghi được dữ liệu của chính mình).
   Nếu để nguyên placeholder, app vẫn chạy bình thường nhưng KHÔNG đồng bộ. */
window.SUPABASE_URL = "https://qihpflzjtvzkqwxaukgo.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpaHBmbHpqdHZ6a3F3eGF1a2dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NjE4MTYsImV4cCI6MjA5NzIzNzgxNn0.CnnfnHpbj3YX3QiCwUdG_5-apf2hSBLkVwNT3sHa6lc";
