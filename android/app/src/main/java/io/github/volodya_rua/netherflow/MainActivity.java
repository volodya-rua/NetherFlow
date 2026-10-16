// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;

// NetherFlow on Android: the same player page as the desktop app; FlowStream's streams through it (below).
public class MainActivity extends BridgeActivity {

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
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if ("localhost".equals(request.getUrl().getHost()) && "/_fs/media".equals(request.getUrl().getPath())) return flowMedia(request);
                if ("localhost".equals(request.getUrl().getHost()) && "/_fs/ahead".equals(request.getUrl().getPath())) return flowAhead(request.getUrl().getQueryParameter("u"));
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    @Override
    public void onDestroy() {
        stopService(new android.content.Intent(this, PlaybackService.class)); // app closed: drop the notification
        super.onDestroy();
    }

    // FlowStream (flowstream.js): a song's stream, which the page plays through its own player as one of its own files
    // (/_fs/media?u=…&m=…), so its equalizer and visuals work on it as on a saved song. Fetched from its source as the
    // player asks for it (a range of it: seeking), straight to this phone. Only googlevideo.com's streams.
    private static WebResourceResponse flowMedia(WebResourceRequest request) {
        String u = request.getUrl().getQueryParameter("u"), mime = request.getUrl().getQueryParameter("m"), range = null;
        for (java.util.Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) if ("range".equalsIgnoreCase(h.getKey())) range = h.getValue();
        String type = mime != null && mime.matches("(audio|video)/[\\w.+-]+") ? mime : "application/octet-stream";
        try {
            if (!streamable(u)) return failed(403);
            Head h = HEADS.remove(u);
            if (h != null && (range == null || range.equals("bytes=0-"))) { // its start, fetched ahead: from memory, the rest from the network as it plays
                java.util.Map<String, String> head = new java.util.HashMap<>();
                head.put("Accept-Ranges", "bytes"); head.put("Cache-Control", "no-store"); head.put("Content-Length", String.valueOf(h.total));
                if (range != null) head.put("Content-Range", "bytes 0-" + (h.total - 1) + "/" + h.total);
                java.io.InputStream rest = new Later(u, "bytes=" + h.bytes.length + "-");
                return new WebResourceResponse(type, null, range != null ? 206 : 200, range != null ? "Partial Content" : "OK", head,
                    new java.io.SequenceInputStream(new ByteArrayInputStream(h.bytes), rest));
            }
            java.net.HttpURLConnection c = open(u, range);
            int code = c.getResponseCode();
            if (code != 200 && code != 206) { c.disconnect(); return failed(code == 403 ? 410 : 502); } // (410: gone, ask anew)
            java.util.Map<String, String> head = new java.util.HashMap<>();
            head.put("Accept-Ranges", "bytes"); head.put("Cache-Control", "no-store");
            for (String k : new String[] { "Content-Length", "Content-Range" }) if (c.getHeaderField(k) != null) head.put(k, c.getHeaderField(k));
            return new WebResourceResponse(type, null, code, code == 206 ? "Partial Content" : "OK", head, c.getInputStream());
        } catch (Exception e) {
            return failed(502);
        }
    }

    private static boolean streamable(String u) {
        try { java.net.URL url = new java.net.URL(u); return "https".equals(url.getProtocol()) && url.getHost().endsWith(".googlevideo.com"); }
        catch (Exception e) { return false; }
    }

    private static java.net.HttpURLConnection open(String u, String range) throws java.io.IOException {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
        c.setConnectTimeout(8000); c.setReadTimeout(20000);
        if (range != null) c.setRequestProperty("Range", range);
        return c;
    }

    // The next song's first 256 KB (about 15 s), fetched ahead (/_fs/ahead?u=…), so it starts at once. Two at most.
    private static final class Head { final byte[] bytes; final long total; Head(byte[] b, long t) { bytes = b; total = t; } }
    private static final java.util.Map<String, Head> HEADS = java.util.Collections.synchronizedMap(new java.util.LinkedHashMap<String, Head>() {
        @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, Head> e) { return size() > 2; }
    });
    private static WebResourceResponse flowAhead(String u) {
        if (streamable(u) && !HEADS.containsKey(u)) new Thread(() -> {
            try {
                java.net.HttpURLConnection c = open(u, "bytes=0-262143");
                String cr = c.getHeaderField("Content-Range");
                if (c.getResponseCode() != 206 || cr == null) return;
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                try (java.io.InputStream in = c.getInputStream()) { byte[] buf = new byte[16384]; for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n); }
                HEADS.put(u, new Head(out.toByteArray(), Long.parseLong(cr.substring(cr.indexOf('/') + 1))));
            } catch (Exception ignored) {}
        }).start();
        return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", null, new ByteArrayInputStream(new byte[0]));
    }

    // a stream from a point on, opened only when it's first read (after the start from memory has been played)
    private static final class Later extends java.io.InputStream {
        private final String u, range; private java.io.InputStream in;
        Later(String u, String range) { this.u = u; this.range = range; }
        private java.io.InputStream in() throws java.io.IOException { if (in == null) in = open(u, range).getInputStream(); return in; }
        @Override public int read() throws java.io.IOException { return in().read(); }
        @Override public int read(byte[] b, int off, int len) throws java.io.IOException { return in().read(b, off, len); }
        @Override public void close() throws java.io.IOException { if (in != null) in.close(); }
    }

    private static WebResourceResponse failed(int code) {
        return new WebResourceResponse("text/plain", "utf-8", code, code == 403 ? "Forbidden" : code == 410 ? "Gone" : "Bad Gateway", null, new ByteArrayInputStream(new byte[0]));
    }


}
