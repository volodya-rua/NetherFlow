// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.Arrays;
import java.util.HashSet;

// NetherFlow on Android: the same player page as the desktop app, plus the same YouTube ad handling.
public class MainActivity extends BridgeActivity {

    // Ad servers the YouTube player calls. Refusing them stops many ads from loading at all.
    private static final String[] AD_HOSTS = { "doubleclick.net", "googlesyndication.com", "googleadservices.com" };
    private static final String[] AD_PATHS = { "/pagead/", "/api/stats/ads", "/get_midroll_" };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ImmersivePlugin.class);
        registerPlugin(NetPlugin.class);
        registerPlugin(PlaybackPlugin.class);
        registerPlugin(SharingPlugin.class);
        registerPlugin(SystemVolumePlugin.class);
        registerPlugin(YtDlPlugin.class);
        registerPlugin(UpdatePlugin.class);
        super.onCreate(savedInstanceState);

        WebView web = getBridge().getWebView();
        // The phone's text size, up to 1.3×: larger than that, the page's big type and its player bar run into each other.
        web.getSettings().setTextZoom(Math.min(130, Math.round(getResources().getConfiguration().fontScale * 100)));
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            // Injected into YouTube's player frame: skips ads and applies the equalizer (frame-helper.js,
            // shared with the desktop app).
            WebViewCompat.addDocumentStartJavaScript(web, readAsset("public/frame-helper.js"),
                new HashSet<>(Arrays.asList("https://www.youtube.com", "https://www.youtube-nocookie.com")));
        }
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (isAd(request.getUrl())) {
                    return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", null, new ByteArrayInputStream(new byte[0]));
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    @Override
    public void onDestroy() {
        stopService(new android.content.Intent(this, PlaybackService.class)); // app closed: drop the notification
        super.onDestroy();
    }

    private String readAsset(String name) {
        try (java.io.InputStream in = getAssets().open(name)) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (java.io.IOException e) {
            return "";
        }
    }

    private static boolean isAd(Uri url) {
        String host = url.getHost() == null ? "" : url.getHost();
        String path = url.getPath() == null ? "" : url.getPath();
        for (String h : AD_HOSTS) if (host.equals(h) || host.endsWith("." + h)) return true;
        if (host.endsWith("youtube.com")) for (String p : AD_PATHS) if (path.startsWith(p)) return true;
        return false;
    }
}
