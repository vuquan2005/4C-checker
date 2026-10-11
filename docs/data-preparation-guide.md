# Hướng Dẫn Sử Dụng Module Data Preparation (`prepare-thread`)

Tài liệu này hướng dẫn cách sử dụng module **Data Preparation** trong công cụ **4C-Checker**, bao gồm lệnh CLI `prepare-thread` (aliases: `prep`, `sync`), cấu trúc thư mục dữ liệu, cơ chế delta-sync và cách tinh chỉnh thủ công các trường key trong file JSON (`thread.json`, `post.json`).

---

## 1. Tổng Quan & Cấu Trúc Dữ Liệu

Module **Data Preparation** chịu trách nhiệm:

1. Thu thập và đồng bộ hóa các bài nộp từ diễn đàn MyBB (kisu4chaui.com).
2. Tự động nhận diện và suy luận buổi học tương ứng (`sessionIndex`).
3. Tải các ảnh minh họa đính kèm BBCode (`student_images/`).
4. Tải các bài tập thực hành từ Google Drive (`drive_files/`) và giải nén (.zip, .rar).
5. Trích xuất metadata OLE và ảnh preview 3D render từ các file CAD Inventor (`cad_previews/`).
6. Quản lý lịch sử chỉnh sửa bài viết của sinh viên theo từng snapshot phiên bản (`version`).

### Cấu trúc thư mục dữ liệu đầu ra

Sau khi chạy lệnh, dữ liệu được tổ chức tại thư mục gốc `--data-dir` (mặc định là `./data`):

```text
data/
└── <threadId>/                          # Ví dụ: data/1336
    ├── config.json                      # [Thread Config] Cấu hình bộ lọc ignore, từ khóa buổi, tiêu chí chấm
    ├── thread.json                      # [Thread Manifest] Tổng hợp toàn bộ bài nộp trong thread
    └── <userFolder>/                    # Chuẩn hóa theo tên: <Tên_Học_Viên>_<UID> (ví dụ: Nguyen_Xuan_Hieu_27392)
        └── <postFolder>/                # Định danh bài: post_<PostID> (ví dụ: post_26115)
            ├── post.json                # [Post Data] Metadata chi tiết của riêng bài nộp này
            ├── student_images/          # Ảnh forum BBCode đã tải về
            ├── drive_files/             # File CAD (.ipt, .iam, .ipn) và tài liệu tải từ Drive
            └── cad_previews/            # Ảnh preview 3D (.png) trích xuất từ file CAD
```

---

## 2. Cách Sử Dụng Lệnh CLI Cơ Bản

### 2.1. Cú pháp cơ bản

```bash
# Cú pháp đầy đủ qua pnpm dev
pnpm dev prepare-thread <thread-id-hoặc-url> [tùy_chọn]

# Hoặc dùng các alias ngắn gọn:
pnpm dev prep <thread-id-hoặc-url> [tùy_chọn]
pnpm dev sync <thread-id-hoặc-url> [tùy_chọn]
```

### 2.2. Các câu lệnh thông dụng

- **Đồng bộ toàn bộ thread:**

  ```bash
  pnpm dev prepare-thread 1336
  # Hoặc dùng URL:
  pnpm dev prepare-thread "https://kisu4chaui.com/showthread.php?tid=1336"
  ```

- **Chế độ Metadata-Only (Nhanh nhất):**

  > Chỉ tải thông tin thread, phân tích bài nộp và cập nhật `thread.json`, không tải file nặng và ảnh.

  ```bash
  pnpm dev prepare-thread 1336 -m
  ```

- **Chỉ đồng bộ một bài viết cụ thể:**

  ```bash
  # Theo Post ID:
  pnpm dev prepare-thread 1336 --post 26115

  # Hoặc theo số thứ tự post:
  pnpm dev prepare-thread 1336 --post 8
  ```

- **Ép buộc tải lại toàn bộ tài nguyên (Force):**

  > Tải lại tất cả ảnh, file Drive kể cả khi đã tồn tại trên máy.

  ```bash
  pnpm dev prepare-thread 1336 --force
  ```

- **Chạy offline từ file HTML tải sẵn:**

  ```bash
  pnpm dev prepare-thread 1336 -i samples/thread_1336.html
  ```

- **Tùy chỉnh số luồng tải song song:**

  ```bash
  pnpm dev prepare-thread 1336 --concurrency 4
  ```

- **Bỏ qua tải một loại tài nguyên cụ thể:**
  ```bash
  pnpm dev prepare-thread 1336 --no-images  # Không tải ảnh BBCode
  pnpm dev prepare-thread 1336 --no-drive   # Không tải file Google Drive
  pnpm dev prepare-thread 1336 --no-cad     # Không quét metadata CAD
  ```

### 2.3. Bảng tham số & tùy chọn (CLI Options)

| Tùy chọn (Option)               | Mặc định     | Ý nghĩa                                                                              |
| :------------------------------ | :----------- | :----------------------------------------------------------------------------------- |
| `<thread-id-or-url>`            | _(Bắt buộc)_ | ID chủ đề (ví dụ: `1336`) hoặc link bài viết trên diễn đàn                           |
| `-d, --data-dir <dir>`          | `./data`     | Thư mục gốc lưu trữ dữ liệu                                                          |
| `-c, --config <file>`           | _None_       | Đường dẫn file cấu hình JSON tùy chỉnh (mặc định tự tìm `config.json` trong thread)  |
| `--ignore-post <ids...>`        | _None_       | Danh sách Post ID cần bỏ qua (ví dụ: `--ignore-post 26090 26145`)                    |
| `--ignore-uid <uids...>`        | _None_       | Danh sách User UID cần bỏ qua (ví dụ: `--ignore-uid 27392 27380`)                    |
| `--session-override <pairs...>` | _None_       | Ghi đè số buổi theo cặp postId:session (ví dụ: `--session-override 26123:2 26167:3`) |
| `-m, --metadata-only`           | `false`      | Chỉ đồng bộ metadata vào `thread.json`, bỏ qua tải assets/CAD                        |
| `--post <id-or-num>`            | _None_       | Chỉ xử lý duy nhất 1 bài viết theo ID hoặc `#postNumber`                             |
| `--force`                       | `false`      | Bắt buộc tải lại tài nguyên dù đã tồn tại trên đĩa                                   |
| `--concurrency <n>`             | `2`          | Số lượng luồng worker xử lý đồng thời                                                |
| `-i, --input <file>`            | _None_       | Đọc từ file HTML nội bộ thay vì cào mạng                                             |
| `--no-images`                   | `false`      | Bỏ qua tải ảnh BBCode vào `student_images/`                                          |
| `--no-drive`                    | `false`      | Bỏ qua tải dữ liệu Drive vào `drive_files/`                                          |
| `--no-cad`                      | `false`      | Bỏ qua trích xuất thông tin & preview CAD 3D vào `cad_previews/`                     |
| `--include-op`                  | `false`      | Bao gồm cả bài viết mở đầu (#1) của chủ thớt                                         |
| `--json`                        | `false`      | Xuất kết quả tổng kết dưới dạng JSON                                                 |

---

## 3. Các Trường Key JSON Có Thể Thay Đổi Bằng Tay

Hệ thống được thiết kế với cơ chế **tự phục hồi (self-healing)** và **ghi đè delta (override diff)**. Khi người dùng chỉnh sửa các trường quan trọng trong JSON và chạy lại lệnh `prepare-thread`, hệ thống sẽ tự động phát hiện và xử lý lại đúng các bài viết bị ảnh hưởng.

---

### 3.1. Cấu hình trung tâm trong `config.json` (Khuyên dùng cho toàn thread)

Đường dẫn: `data/<threadId>/config.json`

File `config.json` được tự động khởi tạo khi đồng bộ thread lần đầu. Bạn có thể cấu hình các quy tắc ignore, từ khóa buổi, và đuôi file ngay tại đây mà không cần đi vào từng bài:

```json
{
  "threadId": "1336",
  "prepare": {
    "ignore": {
      "ignoreOp": true,
      "postIds": ["26090"],
      "postNumbers": [15],
      "uids": ["27392", "27380"],
      "usernames": ["Admin", "GiangVien_*"]
    },
    "session": {
      "keywords": ["buổi", "buoi", "btvn", "tuan", "tuần", "lab", "b"],
      "overrides": {
        "26123": 2,
        "26167": 3
      }
    },
    "drive": {
      "allowedExtensions": [".ipt", ".iam", "ipn", ".ipj", ".idw", ".dwg", ".zip", ".rar"],
      "maxFileSizeBytes": 104857600
    },
    "network": {
      "concurrency": 2,
      "downloadImages": true,
      "downloadDrive": true,
      "extractCad": true
    }
  }
}
```

- **Quy tắc Ignore:**
  - `ignoreOp`: Bỏ qua bài mở đầu #1 (mặc định: `true`).
  - `postIds`: Mảng Post ID cần bỏ qua.
  - `postNumbers`: Mảng số thứ tự bài cần bỏ qua (#15, #20...).
  - `uids`: Mảng UID tác giả cần bỏ qua (Giảng viên, Trợ giảng).
  - `usernames`: Mảng tên tác giả cần bỏ qua (hỗ trợ wildcard như `"Admin_*"`).
- **Cấu hình Buổi học (Session):**
  - `keywords`: Danh sách từ khóa nhận diện số buổi từ nội dung bài viết sinh viên (ví dụ: `buoi 3`, `b3`, `lab 2`...). Thứ tự trong mảng được giữ nguyên khi so khớp Regex (nên đặt các từ khóa dài lên trước và tiền tố ngắn như `"b"` ở cuối).
  - `overrides`: Bản đồ gán cứng số buổi theo Post ID (`{ "<postId>": <sessionNumber> }`). Bài viết được ghi đè ở đây sẽ tự động hóa giải cảnh báo xung đột buổi và tải đúng thư mục buổi trên Google Drive.
- **Tác động khi chạy lại sync:**
  Hệ thống sẽ cập nhật trạng thái các bài bị ignore thành `skipProcessing: true` kèm lý do `skipReason: "IGNORED_UID: ..."` trong `thread.json`, đồng thời bỏ qua toàn bộ việc tải ảnh, tải file Google Drive và trích xuất CAD cho những bài này. Các bài có trong `session.overrides` sẽ được áp dụng số buổi chuẩn ngay từ đầu.

---

### 3.2. Chỉnh sửa trong `post.json` (Can thiệp cục bộ từng bài)

Đường dẫn: `data/<threadId>/<userFolder>/<postFolder>/post.json`

#### 1. `sessionOverride`

- **Kiểu dữ liệu:** `number | null` (Mặc định: `null`)
- **Mục đích:**
  - Dùng khi sinh viên viết sai số buổi trong nội dung bài (ví dụ: nộp bài buổi 2 nhưng bài ghi nhầm là _"buổi 3"_).
  - Giải quyết xung đột giữa số buổi viết trong bài và số buổi suy luận từ bài trước (`SESSION_CONFLICT`).
  - Bổ sung buổi khi bài viết hoàn toàn không ghi số buổi (`SESSION_NOT_FOUND`).
- **Cách sửa:**
  ```json
  "sessionOverride": 2
  ```
  _(Khuyên dùng: Bạn cũng có thể thiết lập trực tiếp tại `data/<threadId>/config.json` mục `session.overrides` hoặc qua CLI `--session-override <postId>:2` để cấu hình được lưu tập trung)._
- **Tác động khi chạy lại sync:**
  Hệ thống so sánh `summary.sessionOverride` với manifest. Khi thấy có sự khác biệt, nó kích hoạt quy trình tải lại Drive với từ khóa tìm kiếm mới (`buoi 2`, `b2`).

#### 2. `skipProcessing`

- **Kiểu dữ liệu:** `boolean` (Mặc định: không có hoặc `false`)
- **Mục đích:**
  - Đánh dấu bỏ qua hoàn toàn bài viết này (ví dụ: bài viết chỉ là bình luận hỏi bài, spam, link Drive bị hỏng/khóa quyền vĩnh viễn).
- **Cách sửa:**
  ```json
  "skipProcessing": true
  ```
- **Tác động khi chạy lại sync:**
  Pipeline sẽ bỏ qua bài viết này trong tất cả các khâu tải assets và phân tích CAD. Kể cả khi chạy với cờ `--force`, các bài có `skipProcessing: true` vẫn được giữ nguyên và bỏ qua an toàn.

#### 3. `driveFiles.status`

- **Kiểu dữ liệu:** `"downloaded" | "failed" | "skipped" | "not_found"`
- **Mục đích:**
  - Kích hoạt tải lại Google Drive cho riêng một bài viết mà không cần dùng `--force` tải lại cả thread.
- **Cách sửa:**
  Đổi giá trị thành `"failed"`:
  ```json
  "driveFiles": {
    "status": "failed"
  }
  ```
- **Tác động khi chạy lại sync:**
  Hàm `needsPostAssetReprocessing` sẽ nhận diện trạng thái lỗi và tải lại toàn bộ file Drive cho bài viết này.

#### 4. `forumImages[i].status`

- **Kiểu dữ liệu:** `"downloaded" | "failed" | "skipped"`
- **Mục đích:** Kích hoạt tải bù ảnh bị lỗi.
- **Cách sửa:** Đổi trạng thái của ảnh mong muốn thành `"failed"`.
- **Tác động khi chạy lại sync:** Pipeline sẽ quét lại và tải bù file ảnh đó vào `student_images/`.

---

### 3.2. Chỉnh sửa trong `thread.json` (Cấp độ Manifest toàn cục)

Đường dẫn: `data/<threadId>/thread.json`

Các bài viết được lưu trữ trong object `posts`, ánh xạ theo `postId`:

```json
{
  "threadId": "1336",
  "syncVersion": 2,
  "posts": {
    "26115": {
      "postId": "26115",
      "userFolder": "Nguyen_Xuan_Hieu_27392",
      "postFolder": "post_26115",
      "syncStatus": "synced",
      "sessionOverride": null,
      "skipProcessing": false
      ...
    }
  }
}
```

Các trường có thể can thiệp:

| Trường (Field)                | Giá trị                                           | Ý nghĩa                                                                                                       |
| :---------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------------------------ |
| `posts[<id>].sessionOverride` | Số nguyên (ví dụ: `2`)                            | Ghi đè buổi học trực tiếp tại cấp manifest.                                                                   |
| `posts[<id>].skipProcessing`  | `true` / `false`                                  | Loại trừ bài nộp khỏi pipeline tải tệp.                                                                       |
| `posts[<id>].syncStatus`      | `"pending"`, `"outdated"`, `"synced"`, `"failed"` | Đổi thành `"pending"` hoặc `"outdated"` để ép hệ thống tải lại toàn bộ assets của bài này ở lần chạy kế tiếp. |
| `posts[<id>].userFolder`      | Chuỗi ký tự                                       | Tên thư mục học viên trên đĩa (nếu cần đổi tên định danh).                                                    |
| `posts[<id>].postFolder`      | Chuỗi ký tự                                       | Tên thư mục bài nộp trên đĩa.                                                                                 |

---

## 4. Quy Trình Xử Lý Xung Đột & Tinh Chỉnh Dữ Liệu

1. **Bước 1: Chạy chuẩn bị dữ liệu ban đầu:**

   ```bash
   pnpm dev prepare-thread 1336
   ```

2. **Bước 2: Xử lý xung đột session tương tác (nếu có):**
   Nếu có sinh viên ghi nhầm buổi (ví dụ: bài trước nộp buổi 1, bài này ghi nhầm thành buổi 4), CLI sẽ nhắc nhở:

   ```text
   ⚠️ Conflict session ở Post #12 (Tran_Kien_Phi): bài ghi buổi 4, suy luận buổi 2.
   Chọn sessionOverride [4/2/s để bỏ qua]:
   ```
   - Nhập `2` để ghi đè thành buổi 2.
   - Hoặc gõ `s` (skip) để giữ nguyên cảnh báo và kiểm tra sau.

3. **Bước 3: Tinh chỉnh qua file `post.json` (nếu cần):**
   Mở `data/1336/<User>/<Post>/post.json`:
   - Chỉnh `"sessionOverride": 2` nếu phát hiện nhầm buổi.
   - Chỉnh `"skipProcessing": true` nếu bài nộp là bình luận hoặc không cần chấm.

4. **Bước 4: Đồng bộ lại:**
   ```bash
   pnpm dev prepare-thread 1336
   ```
   Pipeline sẽ tự động phát hiện các bài đã sửa tay để đồng bộ lại một cách tối ưu nhất.
