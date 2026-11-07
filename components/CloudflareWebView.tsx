import React, { useRef } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
// Import các hàm và biến hằng số UA từ file http.ts của bạn
import { UA, syncCookiesFromWebView, hasClearance } from '../services/http'; 

interface Props {
  domain: string;
  onSuccess: () => void; // Hàm được gọi khi đã vượt CF thành công
}

export const CloudflareWebView: React.FC<Props> = ({ domain, onSuccess }) => {
  const webViewRef = useRef<WebView>(null);

  // Hàm này chạy mỗi khi WebView tải xong hoặc chuyển trang
  const handleNavigationStateChange = async (navState: any) => {
    // Nếu trang đang tải thì bỏ qua
    if (navState.loading) return;

    // Kiểm tra xem trình duyệt ảo đã vào được trang đích chưa
    if (navState.url.includes(domain)) {
      // Dùng hàm có sẵn trong http.ts để check xem có cookie cf_clearance chưa
      const isCleared = await hasClearance(domain);
      
      if (isCleared) {
        console.log('✅ Đã lấy được cf_clearance! Đang đồng bộ cookie...');
        // Dùng hàm có sẵn để chép cookie từ WebView sang Native iOS/Android
        await syncCookiesFromWebView(domain);
        
        // Báo cho màn hình chính biết là đã xong để đóng WebView lại
        onSuccess();
      }
    }
  };

  return (
    <View style={styles.container}>
      {/* WebView này sẽ hiện lên toàn màn hình để user tick Captcha */}
      <WebView
        ref={webViewRef}
        source={{ uri: domain }}
        // BẮT BUỘC dùng chung UA với lệnh fetch (đã export ở http.ts)
        userAgent={UA} 
        onNavigationStateChange={handleNavigationStateChange}
        sharedCookiesEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <ActivityIndicator size="large" color="#000" style={styles.loader} />
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject, // Chiếm toàn bộ màn hình
    backgroundColor: '#fff',
    zIndex: 9999, // Nổi lên trên cùng
  },
  loader: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -15 }, { translateY: -15 }],
  }
});
