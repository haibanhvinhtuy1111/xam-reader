# XamReader

Đọc diễn đàn XenForo 2.x, lọc ảnh/video từ chủ đề. Expo (SDK 52) + TypeScript + NativeWind.

## Chạy lần đầu
1. `npm install`
2. `npx expo install --fix` (căn lại phiên bản các gói theo đúng SDK, rồi commit file lock)
3. Sửa `REMOTE_CONFIG_URL` trong `src/services/domain.ts` trỏ tới file JSON của bạn (mẫu: `domain.example.json`)
4. `npx expo prebuild --platform ios && npx expo run:ios` (không chạy được trong Expo Go vì có module native)

## Build .ipa không ký
Đẩy code lên GitHub, vào Actions > "Build unsigned IPA" > Run workflow, tải artifact `XamReader-unsigned-ipa`, rồi ký bằng ESign/Lcsigned.
