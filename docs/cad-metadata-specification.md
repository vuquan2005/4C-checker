# ĐẶC TẢ KỸ THUẬT CÁC THUỘC TÍNH FILE AUTODESK INVENTOR CAD (.IPT)

> **Mục đích:** Tài liệu kỹ thuật mô tả cấu trúc, thuộc tính và tính chất lưu trữ dữ liệu của file Autodesk Inventor CAD (.ipt), làm cơ sở dữ liệu cho các module xử lý tiếp theo.  
> **Dữ liệu thực nghiệm:** Các file trong thư mục `New Folder/`.

---

## 1. CẤU TRÚC LƯU TRỮ TỔNG QUAN

File `.ipt` của Autodesk Inventor được đóng gói theo định dạng **Microsoft Compound File Binary Format (CFBF / OLE Structured Storage)**.  
Bên trong file gồm nhiều phân vùng lưu trữ (_Storages_) và các luồng nhị phân (_Streams_):

1. **Nhóm OLE Property Sets tiêu chuẩn:**
   - `\x05SummaryInformation` (`Zrxrt4ar...`): Chứa Title, Subject, Author, và ảnh raster 3D preview.
   - `\x05DocumentSummaryInformation` (`Aaalpg0m...`): Chứa thông tin quản lý tài liệu.
   - `\x05DesignTrackingProperties` (`Pypkizqi...`): Chứa Part Number, Material, Designer, phiên bản phần mềm Inventor.
   - `\x05DesignTrackingControl` (`Qz4dgm1g...`): Tự động ghi nhận tên tài khoản người dùng của hệ điều hành Windows thực hiện thao tác lưu tài liệu.
2. **Nhóm Autodesk RSe Storage (`RSeStorage/`):**
   - Chứa các phân đoạn hình học B-Rep (Boundary Representation), cây tính năng, và thông tin phân đoạn `RSeStorage/B*`.
   - Mỗi phân đoạn `B*` có một luồng metadata tương ứng `RSeStorage/M*` ghi nhận các mốc thời gian của phân đoạn đó.
3. **Luồng cấu hình tài liệu (`UFRxDoc`):**
   - Chứa thông tin hiển thị và đường dẫn tệp tuyệt đối trên hệ thống tệp tin Windows nơi tệp được lưu.

---

## 2. DANH MỤC VÀ TÍNH CHẤT CÁC TRƯỜNG DỮ LIỆU ĐỌC ĐƯỢC

| Tên trường dữ liệu            | Vị trí trích xuất trong file                                                           | Định dạng dữ liệu                                                | Tính chất kỹ thuật & Sự biến đổi khi thao tác                                                                                                                                                                                                         |
| :---------------------------- | :------------------------------------------------------------------------------------- | :--------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`rseSegmentIds`**           | Danh sách tên các stream trong `RSeStorage/B*` (8 định danh, bắt đầu bằng ký tự `B`)   | Mảng 8 chuỗi ký tự (ví dụ: `Bv5nuzad...`)                        | **Định danh phân đoạn tài liệu:** Được sinh ra khi tệp được khởi tạo mới (`File -> New`). Khi thực hiện `Save As`, xóa toàn bộ sketch dựng lại hình mới, hoặc thay đổi toàn bộ iProperties, bộ 8 định danh này **vẫn giữ nguyên**, không bị sinh lại. |
| **`creationDate`**            | Vị trí đầu tiên của các chuỗi ngày giờ trong `RSeStorage/M*`                           | Chuỗi ký tự ASCII (`"MM/DD/YYYY HH:mm:ss"`)                      | **Mốc thời gian tạo ban đầu:** Được ghi nhận tại thời điểm tệp được tạo lần đầu tiên. Khi lưu sang bản sao mới (`Save As`) hoặc sửa đổi mô hình, mốc thời gian tạo ban đầu này vẫn được bảo lưu trong ruột các phân đoạn nhị phân.                    |
| **`lastSavedDate`**           | Vị trí cuối cùng của các chuỗi ngày giờ trong `RSeStorage/M*` hoặc OLE Root Entry `mt` | Chuỗi ký tự ASCII hoặc số nguyên 64-bit Windows `FILETIME` (UTC) | **Mốc thời gian lưu gần nhất:** Được cập nhật mỗi khi người dùng thực hiện thao tác lưu tệp (`Save` / `Ctrl + S`).                                                                                                                                    |
| **`lastSavedByWindowsUser`**  | Stream `Design Tracking Control` (`\x05Qz4dgm1g...`)                                   | Chuỗi Unicode                                                    | **Tài khoản Windows lưu gần nhất:** Do phần mềm Inventor tự động đọc từ biến môi trường tài khoản người dùng của Windows và ghi vào tệp khi lưu. Trường này không chịu sự can thiệp từ hộp thoại iProperties thông thường.                            |
| **`originalFilePath`**        | Stream `UFRxDoc`                                                                       | Chuỗi Unicode đường dẫn Windows                                  | **Đường dẫn tệp trên hệ điều hành:** Lưu lại đường dẫn tuyệt đối của tệp tại phiên làm việc (ví dụ: `C:\Users\VuQuan\Downloads\...`).                                                                                                                 |
| **`softwareVersion`**         | Stream `Design Tracking Properties` (`\x05Pypkizqi...`)                                | Chuỗi ký tự (ví dụ: `2024.4 (Build 284460030, 460C)`)            | **Phiên bản phần mềm:** Ghi nhận phiên bản và số hiệu bản dựng của Autodesk Inventor được sử dụng để lưu tệp. Khi tệp được mở và lưu trên phiên bản Inventor mới hơn, giá trị này sẽ tự động cập nhật lên phiên bản mới hơn đó.                       |
| **`designer`** / **`author`** | Stream `Pypkizqi...` và `Zrxrt4ar...`                                                  | Chuỗi ký tự                                                      | **Tác giả thiết kế:** Khởi tạo theo cấu hình mặc định của Inventor hoặc tài khoản hệ thống. Người dùng có thể thay đổi thủ công thông qua hộp thoại iProperties.                                                                                      |
| **`partNumber`**              | Stream `Design Tracking Properties`                                                    | Chuỗi ký tự                                                      | **Mã/Tên chi tiết:** Mặc định lấy theo tên tệp ban đầu, có thể thay đổi thủ công qua iProperties.                                                                                                                                                     |
| **`geometryFingerprint`**     | Các luồng B-Rep `RSeStorage/B*`                                                        | Kích thước byte và mã băm SHA-256                                | **Dấu vết hình học:** Phản ánh dữ liệu của mô hình 3D. Khi mô hình hình học bị xóa hoặc thay đổi, dung lượng các luồng B-Rep và mã băm này sẽ thay đổi theo.                                                                                          |
| **`preview`**                 | Stream `Zrxrt4ar...`                                                                   | Ảnh PNG 512x512 pixels (RGBA)                                    | **Ảnh xem trước:** Do Inventor tự động kết xuất từ góc nhìn 3D hiện tại của mô hình tại thời điểm lưu.                                                                                                                                                |

---

## 3. DỮ LIỆU ĐO ĐẠC THỰC TẾ TRONG KỊCH BẢN THỬ NGHIỆM (`NEW FOLDER/`)

Dưới đây là các giá trị thuộc tính trích xuất trực tiếp từ các tệp thử nghiệm trong thư mục `New Folder/`:

| Tên tệp                                               | Dung lượng | Phiên bản Inventor         | Ngày tạo ban đầu      | Ngày lưu gần nhất     | Designer (iProperties) | User Windows lưu gần nhất | Đường dẫn tệp ghi nhận                                     | Bộ mã phân đoạn (`rseSegmentIds`)          |
| :---------------------------------------------------- | :--------- | :------------------------- | :-------------------- | :-------------------- | :--------------------- | :------------------------ | :--------------------------------------------------------- | :----------------------------------------- |
| **`a.ipt`** _(Tệp gốc 1)_                             | 280,576 B  | `2024.4 (Build 284460030)` | `10/07/2026 15:53:15` | `10/07/2026 20:00:05` | `IronMan`              | `HI TCC`                  | `C:\Users\HI TCC\Documents\Inventor\Buổi3\IronMan.ipt`     | **Bộ A** (8 mã bắt đầu bằng `Bv5nuzad...`) |
| **`a - Copy.ipt`** _(Mở `a.ipt` lưu lại)_             | 280,064 B  | `2025.5 (Build 295498000)` | `10/07/2026 15:53:15` | `10/08/2026 10:11:46` | `IronMan`              | `VuQuan`                  | `C:\Users\VuQuan\Downloads\New Folder\a - Copy.ipt`        | **Bộ A** _(Trùng khớp 100%)_               |
| **`a - Copy (2).ipt`** _(Mở `a.ipt` đổi iProperties)_ | 280,064 B  | `2025.5 (Build 295498000)` | `10/07/2026 15:53:15` | `10/08/2026 10:18:00` | `aefaawef`             | `VuQuan`                  | `C:\Users\VuQuan\Downloads\New Folder\a - Copy (2).ipt`    | **Bộ A** _(Trùng khớp 100%)_               |
| **`b.ipt`** _(Tệp gốc 2)_                             | 237,056 B  | `2024.4 (Build 284460030)` | `10/07/2026 20:00:56` | `10/07/2026 20:00:56` | `Part14`               | `Minh Nguyen`             | `D:\inventor\buoi 3\Part14.ipt`                            | **Bộ B** (8 mã bắt đầu bằng `Bvoad6bh...`) |
| **`b - Copy.ipt`** _(Mở `b.ipt` xóa sketch vẽ lại)_   | 74,240 B   | `2025.5 (Build 295498000)` | `10/07/2026 20:00:56` | `10/08/2026 10:13:18` | `Part14`               | `VuQuan`                  | `C:\Users\VuQuan\Downloads\New Folder\b - Copy.ipt`        | **Bộ B** _(Trùng khớp 100%)_               |
| **`template1.ipt`** _(Tạo mới mm)_                    | 60,416 B   | `2025.5 (Build 295498000)` | `10/08/2026 10:10:33` | `10/08/2026 10:10:33` | `template1`            | `VuQuan`                  | `C:\Users\VuQuan\Downloads\New Folder\template1.ipt`       | **Bộ C** (8 mã bắt đầu bằng `Bgpya2ec...`) |
| **`template2(inch).ipt`** _(Tạo mới inch)_            | 60,416 B   | `2025.5 (Build 295498000)` | `10/08/2026 10:10:58` | `10/08/2026 10:10:58` | `template2(inch)`      | `VuQuan`                  | `C:\Users\VuQuan\Downloads\New Folder\template2(inch).ipt` | **Bộ D** (8 mã bắt đầu bằng `Bshu3ayc...`) |

---

## 4. PHÂN TÍCH TÍNH CHẤT BIẾN ĐỔI THEO CÁC DẠNG THAO TÁC

### 4.1. Thao tác khởi tạo mới (`File -> New`)

- Khi tạo mới một tệp độc lập, Inventor khởi tạo ngẫu nhiên một bộ 8 mã `rseSegmentIds` hoàn toàn riêng biệt (`template1.ipt` mang Bộ C, `template2(inch).ipt` mang Bộ D).
- `creationDate` và `lastSavedDate` có giá trị trùng nhau tại thời điểm tạo.
- `lastSavedByWindowsUser` và `designer` phản ánh tài khoản và cấu hình của máy tạo.

### 4.2. Thao tác mở tệp có sẵn và lưu lại (`Save As`)

- **Thuộc tính không thay đổi:**
  - Bộ mã `rseSegmentIds` giữ nguyên 100% so với tệp gốc.
  - Mốc `creationDate` ban đầu giữ nguyên giá trị của tệp gốc.
  - Các trường iProperties (`designer`, `partNumber`) giữ nguyên giá trị nếu người dùng không can thiệp.
- **Thuộc tính thay đổi:**
  - `lastSavedDate` cập nhật theo thời điểm lưu mới.
  - `lastSavedByWindowsUser` cập nhật thành tên tài khoản Windows của máy thực hiện lưu.
  - `originalFilePath` cập nhật đường dẫn tệp mới trên hệ thống.
  - `softwareVersion` cập nhật theo phiên bản phần mềm của máy mở tệp nếu có sự chênh lệch phiên bản (ví dụ từ `2024.4` lên `2025.5`).

### 4.3. Thao tác mở tệp có sẵn, xóa toàn bộ mô hình hình học và dựng lại mô hình mới

- **Thuộc tính không thay đổi:**
  - Bộ mã `rseSegmentIds` không bị thay đổi, vẫn giữ nguyên bộ mã của tệp gốc.
  - Mốc `creationDate` ban đầu vẫn giữ nguyên giá trị của tệp gốc.
  - Các trường metadata trong iProperties (`designer`, `partNumber`) không tự động xóa hay đặt lại, vẫn bảo lưu giá trị từ tệp gốc ban đầu.
- **Thuộc tính thay đổi:**
  - Dung lượng tệp và dữ liệu `geometryFingerprint` (kích thước các luồng B-Rep và mã băm SHA-256) thay đổi tương ứng theo mô hình mới được dựng.
  - Ảnh xem trước (`preview`) được kết xuất lại theo mô hình mới.
  - `lastSavedDate` và `lastSavedByWindowsUser` cập nhật theo phiên làm việc mới.

### 4.4. Thao tác mở tệp có sẵn và thay đổi các trường trong hộp thoại iProperties

- **Thuộc tính không thay đổi:**
  - Bộ mã `rseSegmentIds` giữ nguyên 100%.
  - Mốc `creationDate` ban đầu trong các phân đoạn nhị phân giữ nguyên.
- **Thuộc tính thay đổi:**
  - Các trường văn bản trong OLE Property Sets (`designer`, `author`, `partNumber`, `title`...) nhận giá trị văn bản mới do người dùng nhập.
  - `lastSavedByWindowsUser` trong luồng `Design Tracking Control` ghi nhận tài khoản Windows thực hiện việc chỉnh sửa.

---

## 5. DỮ LIỆU THÔ (RAW DATA) CÁC TỆP TRONG KỊCH BẢN

```json
{
  "a.ipt": {
    "filePath": "New Folder/a.ipt",
    "fileName": "a.ipt",
    "fileExtension": ".ipt",
    "fileSizeBytes": 280576,
    "hasPreview": true,
    "rseSegmentIds": [
      "Bv5nuzad35ivxlv5densgrhyljh",
      "Bssa53xbqxc22hoi2n422g23lfe",
      "Bq54hcyc4ynjg5s34fn3wuamkfi",
      "Brkal6rh21vqpjj2rnspjpb16jo",
      "Bgxofp5captddro4quj5mjh2dnk",
      "Bj4rjgggheq5hdqmvviqrzew3bd",
      "Btuxc6ddqkx3oskhr4rcn4mkfnh",
      "Bljcniwcbxpi4saraffmic15lni"
    ],
    "previewWidth": 512,
    "previewHeight": 512,
    "previewSizeBytes": 272739,
    "creationDate": "10/07/2026 15:53:15",
    "lastSavedDate": "10/07/2026 20:00:05",
    "originalFilePath": "C:\\Users\\HI TCC\\Documents\\Inventor\\Buổi3\\IronMan.ipt",
    "softwareVersion": "2024.4 (Build 284460030, 460C)",
    "partNumber": "IronMan",
    "designer": "HI TCC",
    "lastSavedByWindowsUser": "HI TCC",
    "author": "HI TCC",
    "geometryFingerprint": {
      "totalStreams": 8,
      "brepStreamSizes": [23697, 362, 29209, 823, 7793, 57, 157, 350],
      "contentHash": "f4663ac2c2dfc673"
    }
  },
  "a - Copy.ipt": {
    "filePath": "New Folder/a - Copy.ipt",
    "fileName": "a - Copy.ipt",
    "fileExtension": ".ipt",
    "fileSizeBytes": 280064,
    "hasPreview": true,
    "rseSegmentIds": [
      "Bv5nuzad35ivxlv5densgrhyljh",
      "Bssa53xbqxc22hoi2n422g23lfe",
      "Bq54hcyc4ynjg5s34fn3wuamkfi",
      "Brkal6rh21vqpjj2rnspjpb16jo",
      "Bgxofp5captddro4quj5mjh2dnk",
      "Bj4rjgggheq5hdqmvviqrzew3bd",
      "Btuxc6ddqkx3oskhr4rcn4mkfnh",
      "Bljcniwcbxpi4saraffmic15lni"
    ],
    "previewWidth": 512,
    "previewHeight": 512,
    "previewSizeBytes": 29248,
    "creationDate": "10/07/2026 15:53:15",
    "lastSavedDate": "10/08/2026 10:11:46",
    "originalFilePath": "C:\\Users\\VuQuan\\Downloads\\New Folder\\a - Copy.ipt",
    "softwareVersion": "2025.5 (Build 295498000, 498)",
    "partNumber": "IronMan",
    "designer": "HI TCC",
    "lastSavedByWindowsUser": "VuQuan",
    "author": "HI TCC",
    "geometryFingerprint": {
      "totalStreams": 8,
      "brepStreamSizes": [23696, 363, 29226, 816, 7584, 57, 157, 350],
      "contentHash": "f26122fb3618e588"
    }
  },
  "a - Copy (2).ipt": {
    "filePath": "New Folder/a - Copy (2).ipt",
    "fileName": "a - Copy (2).ipt",
    "fileExtension": ".ipt",
    "fileSizeBytes": 280064,
    "hasPreview": true,
    "rseSegmentIds": [
      "Bv5nuzad35ivxlv5densgrhyljh",
      "Bssa53xbqxc22hoi2n422g23lfe",
      "Bq54hcyc4ynjg5s34fn3wuamkfi",
      "Brkal6rh21vqpjj2rnspjpb16jo",
      "Bgxofp5captddro4quj5mjh2dnk",
      "Bj4rjgggheq5hdqmvviqrzew3bd",
      "Btuxc6ddqkx3oskhr4rcn4mkfnh",
      "Bljcniwcbxpi4saraffmic15lni"
    ],
    "previewWidth": 512,
    "previewHeight": 512,
    "previewSizeBytes": 29248,
    "creationDate": "10/07/2026 15:53:15",
    "lastSavedDate": "10/08/2026 10:18:00",
    "originalFilePath": "C:\\Users\\VuQuan\\Downloads\\New Folder\\a - Copy (2).ipt",
    "softwareVersion": "2025.5 (Build 295498000, 498)",
    "partNumber": "Generic",
    "designer": "aefaawef",
    "lastSavedByWindowsUser": "VuQuan",
    "author": "ádfadfwerqw",
    "geometryFingerprint": {
      "totalStreams": 8,
      "brepStreamSizes": [23701, 363, 29234, 816, 7598, 57, 157, 350],
      "contentHash": "33dd58782746dc46"
    }
  },
  "b.ipt": {
    "filePath": "New Folder/b.ipt",
    "fileName": "b.ipt",
    "fileExtension": ".ipt",
    "fileSizeBytes": 237056,
    "hasPreview": true,
    "rseSegmentIds": [
      "Bvoad6bhyalenqoczvkgroznifo",
      "Byt1nz6hnxr3upjyonfiuqgcvbl",
      "Bvvaat1c13gr2x2lhvb5ojmtcjh",
      "Bp1a2r6ckrfjn2hzmenxrnwkkbe",
      "Bhaq4tybspdjobbkfmunhverenp",
      "Bgu1fklesxuy2cl1g3pe2nnsefo",
      "Bqq42xjecijhd31dinb3brudyjg",
      "Bnt6v1xbb5ebvsfgyvwhuuebtjl"
    ],
    "previewWidth": 512,
    "previewHeight": 512,
    "previewSizeBytes": 170616,
    "creationDate": "10/07/2026 20:00:56",
    "lastSavedDate": "10/07/2026 20:00:56",
    "originalFilePath": "D:\\inventor\\buoi 3\\Part14.ipt",
    "lastSavedByWindowsUser": "Minh Nguyen",
    "author": "Minh Nguyen",
    "softwareVersion": "2024.4 (Build 284460030, 460C)",
    "partNumber": "Part14",
    "designer": "Minh Nguyen",
    "geometryFingerprint": {
      "totalStreams": 8,
      "brepStreamSizes": [3861, 363, 3562, 818, 7793, 57, 142, 350],
      "contentHash": "2007a7c05850540b"
    }
  },
  "b - Copy.ipt": {
    "filePath": "New Folder/b - Copy.ipt",
    "fileName": "b - Copy.ipt",
    "fileExtension": ".ipt",
    "fileSizeBytes": 74240,
    "hasPreview": true,
    "rseSegmentIds": [
      "Bvoad6bhyalenqoczvkgroznifo",
      "Byt1nz6hnxr3upjyonfiuqgcvbl",
      "Bvvaat1c13gr2x2lhvb5ojmtcjh",
      "Bp1a2r6ckrfjn2hzmenxrnwkkbe",
      "Bhaq4tybspdjobbkfmunhverenp",
      "Bgu1fklesxuy2cl1g3pe2nnsefo",
      "Bqq42xjecijhd31dinb3brudyjg",
      "Bnt6v1xbb5ebvsfgyvwhuuebtjl"
    ],
    "previewWidth": 512,
    "previewHeight": 512,
    "previewSizeBytes": 66556,
    "creationDate": "10/07/2026 20:00:56",
    "lastSavedDate": "10/08/2026 10:13:18",
    "originalFilePath": "C:\\Users\\VuQuan\\Downloads\\New Folder\\b - Copy.ipt",
    "softwareVersion": "2025.5 (Build 295498000, 498)",
    "partNumber": "Part14",
    "designer": "Minh Nguyen",
    "lastSavedByWindowsUser": "VuQuan",
    "author": "Minh Nguyen",
    "geometryFingerprint": {
      "totalStreams": 8,
      "brepStreamSizes": [3123, 433, 1813, 816, 7584, 57, 207, 350],
      "contentHash": "3aaca328e6a90389"
    }
  },
  "template1.ipt": {
    "filePath": "New Folder/template1.ipt",
    "fileName": "template1.ipt",
    "fileExtension": ".ipt",
    "fileSizeBytes": 60416,
    "hasPreview": true,
    "rseSegmentIds": [
      "Bgpya2ecpeqt4igmcekykz5brnf",
      "Bso22wif6r1zv1fu64rt1woxpfn",
      "Brramtddipz2ynxkb45hnh6ohbn",
      "Bhnprszegqibcxhbafp4tcbz5jk",
      "Bzyacpicbkuujzwqi3op4glvxfj",
      "Buro3hhgwt6jc56rwu1e4xpstjk",
      "Bvejdgcavw4bo4frkfm1jnhu6jp",
      "Bwlpll1fjw3bcgcas3m5ortljfb"
    ],
    "previewWidth": 512,
    "previewHeight": 512,
    "previewSizeBytes": 2306,
    "creationDate": "10/08/2026 10:10:33",
    "lastSavedDate": "10/08/2026 10:10:33",
    "originalFilePath": "C:\\Users\\VuQuan\\Downloads\\New Folder\\template1.ipt",
    "lastSavedByWindowsUser": "VuQuan",
    "author": "VuQuan",
    "softwareVersion": "2025.5 (Build 295498000, 498)",
    "partNumber": "template1",
    "designer": "VuQuan",
    "geometryFingerprint": {
      "totalStreams": 8,
      "brepStreamSizes": [2490, 362, 1086, 777, 7594, 57, 112, 347],
      "contentHash": "8094603da76b1ca2"
    }
  },
  "template2(inch).ipt": {
    "filePath": "New Folder/template2(inch).ipt",
    "fileName": "template2(inch).ipt",
    "fileExtension": ".ipt",
    "fileSizeBytes": 60416,
    "hasPreview": true,
    "rseSegmentIds": [
      "Bshu3ayc2lo2seyavvukehg6mnd",
      "Bpcod5hb1rdhgkzf2e3c4cu1djn",
      "Birjztlfk6az5vkvhfhwz26khjp",
      "Bwrujnvcvs1odwlxyuidl2rp4bk",
      "B5kfq23h6csb1g6ommjhtkzzffm",
      "B3dv1bkezv2dbgpsuv4l6ugwjbm",
      "Bpeife1heu2ojaqt6ebz616vljp",
      "Bq2gse2dhbbhteop6ev2mgozkfi"
    ],
    "previewWidth": 512,
    "previewHeight": 512,
    "previewSizeBytes": 2250,
    "creationDate": "10/08/2026 10:10:58",
    "lastSavedDate": "10/08/2026 10:10:58",
    "originalFilePath": "C:\\Users\\VuQuan\\Downloads\\New Folder\\template2(inch).ipt",
    "lastSavedByWindowsUser": "VuQuan",
    "author": "VuQuan",
    "softwareVersion": "2025.5 (Build 295498000, 498)",
    "partNumber": "template2(inch)",
    "designer": "VuQuan",
    "geometryFingerprint": {
      "totalStreams": 8,
      "brepStreamSizes": [2476, 362, 1083, 770, 7554, 57, 112, 345],
      "contentHash": "99356716d7d48243"
    }
  }
}
```

