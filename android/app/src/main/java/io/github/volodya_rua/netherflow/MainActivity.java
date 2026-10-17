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

    // The opening splash (res/values/styles.xml): Android's own, held until the page has built itself — the page says so
    // (ImmersivePlugin.splashDone, at the end of its script) — so there's one splash, straight into the app, rather than
    // the splash, then a blank screen, then the page's own. Then faded out. 5 s at most, whatever happens.
    static volatile boolean pageBuilt = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        androidx.core.splashscreen.SplashScreen splash = androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        final long since = android.os.SystemClock.uptimeMillis();
        pageBuilt = false;
        splash.setKeepOnScreenCondition(() -> !pageBuilt && android.os.SystemClock.uptimeMillis() - since < 5000);
        // (the page can't draw while the splash is held, so the splash stays up, over it, until the page's first frame is
        // ready — then faded off the app itself, not off a blank screen; 0.7 s at most)
        splash.setOnExitAnimationListener(view -> {
            final boolean[] gone = { false };
            Runnable fade = () -> {
                if (gone[0]) return;
                gone[0] = true;
                android.view.View icon = view.getIconView();
                if (icon != null) icon.animate().scaleX(1.06f).scaleY(1.06f).setDuration(280).start();
                view.getView().animate().alpha(0f).setDuration(280).setInterpolator(new android.view.animation.DecelerateInterpolator()).withEndAction(view::remove).start();
            };
            WebView page = getBridge() != null ? getBridge().getWebView() : null;
            if (page != null) page.postVisualStateCallback(0, new WebView.VisualStateCallback() { @Override public void onComplete(long id) { fade.run(); } });
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(fade, 700);
        });
        registerPlugin(ImmersivePlugin.class);
        registerPlugin(NetPlugin.class);
        registerPlugin(PlaybackPlugin.class);
        registerPlugin(SharingPlugin.class);
        registerPlugin(SystemVolumePlugin.class);
        registerPlugin(FilesPlugin.class);
        registerPlugin(UpdatePlugin.class);
        super.onCreate(savedInstanceState);

        WebView web = getBridge().getWebView();
        // The phone's text size, up to 1.3×: larger than that, the page's big type and its player bar run into each other.
        web.getSettings().setTextZoom(Math.min(130, Math.round(getResources().getConfiguration().fontScale * 100)));
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                android.net.Uri q = request.getUrl();
                if ("localhost".equals(q.getHost()) && "/_fs/media".equals(q.getPath())) return flowMedia(request);
                if ("localhost".equals(q.getHost()) && "/_fs/ahead".equals(q.getPath())) return flowAhead(q.getQueryParameter("u"), q.getQueryParameter("id"), q.getQueryParameter("g"));
                if ("localhost".equals(q.getHost()) && "/_fs/url".equals(q.getPath())) return handOver(q.getQueryParameter("t"), q.getQueryParameter("u"));
                if ("localhost".equals(q.getHost()) && "/_fs/clear".equals(q.getPath())) return forgetKept(q.getQueryParameter("g"));
                return super.shouldInterceptRequest(view, request);
            }
        });
        keptDir = new java.io.File(getCacheDir(), "heads");
    }

    @Override
    public void onDestroy() {
        stopService(new android.content.Intent(this, PlaybackService.class)); // app closed: drop the notification
        super.onDestroy();
    }

    // FlowStream (flowstream.js): a song's stream, which the page plays through its own player as one of its own files
    // (/_fs/media?u=…&m=…&id=…), so its equalizer and visuals work on it as on a saved song. Fetched from its source as
    // the player asks for it (a range of it: seeking), straight to this phone. Only googlevideo.com's streams.
    // Its start kept on the phone (below): /_fs/media?id=…&m=…&t=… with no address yet, played from there at once while
    // the page finds the address and hands it over (/_fs/url?t=…&u=…).
    private static WebResourceResponse flowMedia(WebResourceRequest request) {
        android.net.Uri q = request.getUrl();
        String u = q.getQueryParameter("u"), mime = q.getQueryParameter("m"), id = q.getQueryParameter("id"), token = q.getQueryParameter("t"), range = null;
        for (java.util.Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) if ("range".equalsIgnoreCase(h.getKey())) range = h.getValue();
        String type = mime != null && mime.matches("(audio|video)/[\\w.+-]+") ? mime : "application/octet-stream";
        boolean first = range == null || range.equals("bytes=0-");
        try {
            if (u == null) { // its start kept here: from the phone, the rest once the page has handed the address over
                Head k = first ? readKept(id) : null;
                if (k != null) return startThenRest(type, range, k, new Later(null, token, "bytes=" + k.bytes.length + "-", id, k.total));
                u = urlFor(token); // (not kept after all, or a seek: from its source)
            }
            if (!streamable(u)) return failed(403);
            Head h = HEADS.remove(u);
            if (h != null && first) return startThenRest(type, range, h, new Later(u, null, "bytes=" + h.bytes.length + "-", null, h.total)); // (its start, fetched ahead: from memory)
            java.net.HttpURLConnection c = open(u, range);
            int code = c.getResponseCode();
            if (code != 200 && code != 206) { c.disconnect(); return failed(code == 403 ? 410 : 502); } // (410: gone, ask anew)
            java.util.Map<String, String> head = new java.util.HashMap<>();
            head.put("Accept-Ranges", "bytes"); head.put("Cache-Control", "no-store");
            for (String k : new String[] { "Content-Length", "Content-Range" }) if (c.getHeaderField(k) != null) head.put(k, c.getHeaderField(k));
            if (first) keepStart(id, u, q.getQueryParameter("g")); // (for next time)
            return new WebResourceResponse(type, null, code, code == 206 ? "Partial Content" : "OK", head, c.getInputStream());
        } catch (Exception e) {
            return failed(502);
        }
    }

    // its start from memory or the phone, then the rest from its source as it plays
    private static WebResourceResponse startThenRest(String type, String range, Head h, java.io.InputStream rest) {
        java.util.Map<String, String> head = new java.util.HashMap<>();
        head.put("Accept-Ranges", "bytes"); head.put("Cache-Control", "no-store"); head.put("Content-Length", String.valueOf(h.total));
        if (range != null) head.put("Content-Range", "bytes 0-" + (h.total - 1) + "/" + h.total);
        return new WebResourceResponse(type, null, range != null ? 206 : 200, range != null ? "Partial Content" : "OK", head,
            new java.io.SequenceInputStream(new ByteArrayInputStream(h.bytes), rest));
    }

    // The first 256 KB of the last 100 songs played, kept on this phone (its cache: Android may clear it when space runs
    // low), so a song starts the moment it's played, even the first after opening. Each: its stream's length, then its
    // start. Fetched alongside the first time a song plays, or as the next song, ahead. A kept start whose stream turns
    // out to be another length (re-encoded since) is dropped. ponytail: the last 100 kept, not the most played.
    private static java.io.File keptDir;
    private static java.io.File kept(String id) { return keptDir != null && id != null && id.matches("[\\w-]{11}") ? new java.io.File(keptDir, id) : null; }
    private static Head readKept(String id) {
        java.io.File f = kept(id);
        if (f == null || !f.isFile()) return null;
        try (java.io.DataInputStream in = new java.io.DataInputStream(new java.io.FileInputStream(f))) {
            long total = in.readLong(); byte[] b = new byte[(int) f.length() - 8]; in.readFully(b);
            return new Head(b, total);
        } catch (Exception e) { return null; }
    }
    private static void saveKept(String id, Head h) {
        java.io.File f = kept(id);
        if (f == null || f.exists() || h.bytes.length < 262144) return;
        try {
            keptDir.mkdirs();
            java.io.File part = new java.io.File(keptDir, id + ".part");
            try (java.io.DataOutputStream out = new java.io.DataOutputStream(new java.io.FileOutputStream(part))) { out.writeLong(h.total); out.write(h.bytes); }
            if (!part.renameTo(f)) part.delete();
            java.io.File[] all = keptDir.listFiles((d, n) -> !n.endsWith(".part"));
            if (all != null && all.length > 110) { // (the oldest beyond 100 go)
                java.util.Arrays.sort(all, (a, z) -> Long.compare(z.lastModified(), a.lastModified()));
                for (int i = 100; i < all.length; i++) all[i].delete();
            }
        } catch (Exception ignored) {}
    }
    // Clear history: the kept starts go too (a trace of what was played), and the next songs' in memory
    // The page's era: a new one at each Clear history, given with every song it asks for; only a start asked for in the
    // latest is kept (a song that began before the clear isn't kept after it). null: any, till the first clear in this run.
    private static volatile String keptEra;
    private static boolean keptNow(String era) { String e = keptEra; return !"off".equals(era) && (e == null || e.equals(era)); } // (off: Settings, Instant start)
    private static WebResourceResponse forgetKept(String era) {
        keptEra = era == null ? "" : era; HEADS.clear();
        java.io.File[] all = keptDir == null ? null : keptDir.listFiles();
        if (all != null) for (java.io.File f : all) f.delete();
        return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", null, new ByteArrayInputStream(new byte[0]));
    }
    private static void keepStart(String id, String u, String era) { java.io.File f = kept(id); if (f != null && !f.exists() && keptNow(era)) new Thread(() -> { Head h = fetchStart(u); if (h != null && keptNow(era)) saveKept(id, h); }).start(); }

    // The addresses the page hands over, by the token of the request waiting for one ("" when it found none). 50 at most.
    private static final java.util.Map<String, String> URLS = new java.util.LinkedHashMap<String, String>() {
        @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, String> e) { return size() > 50; }
    };
    private static WebResourceResponse handOver(String token, String u) {
        if (token != null) synchronized (URLS) { URLS.put(token, u == null ? "" : u); URLS.notifyAll(); }
        return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", null, new ByteArrayInputStream(new byte[0]));
    }
    // (waited for: 20 s at most)
    private static String urlFor(String token) throws java.io.IOException {
        long until = System.currentTimeMillis() + 20000;
        synchronized (URLS) {
            while (token != null && !URLS.containsKey(token) && System.currentTimeMillis() < until) {
                try { URLS.wait(Math.max(1, until - System.currentTimeMillis())); } catch (InterruptedException e) { break; }
            }
            String u = token == null ? null : URLS.get(token);
            if (!streamable(u)) throw new java.io.IOException("no address for it");
            return u;
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

    // The next song's first 256 KB (about 15 s), fetched ahead (/_fs/ahead?u=…&id=…), so it starts at once (and kept on
    // the phone too, above). Two at most in memory.
    private static final class Head { final byte[] bytes; final long total; Head(byte[] b, long t) { bytes = b; total = t; } }
    private static final java.util.Map<String, Head> HEADS = java.util.Collections.synchronizedMap(new java.util.LinkedHashMap<String, Head>() {
        @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, Head> e) { return size() > 2; }
    });
    private static WebResourceResponse flowAhead(String u, String id, String era) {
        java.io.File f = kept(id);
        if (streamable(u) && !HEADS.containsKey(u) && (f == null || !f.exists())) new Thread(() -> { // (kept already: not fetched again)
            Head h = fetchStart(u);
            if (h != null) { HEADS.put(u, h); if (keptNow(era)) saveKept(id, h); }
        }).start();
        return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", null, new ByteArrayInputStream(new byte[0]));
    }
    private static Head fetchStart(String u) {
        try {
            java.net.HttpURLConnection c = open(u, "bytes=0-262143");
            String cr = c.getHeaderField("Content-Range");
            if (c.getResponseCode() != 206 || cr == null) return null;
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            try (java.io.InputStream in = c.getInputStream()) { byte[] buf = new byte[16384]; for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n); }
            return new Head(out.toByteArray(), Long.parseLong(cr.substring(cr.indexOf('/') + 1)));
        } catch (Exception e) { return null; }
    }

    // a stream from a point on, opened only when it's first read (after the start from memory or the phone has been
    // played): from its address, or the one the page hands over for token; not the length of the start's stream (a
    // kept start re-encoded since): that start dropped, and the player's error makes the page ask again
    private static final class Later extends java.io.InputStream {
        private final String u, token, range, id; private final long total; private java.io.InputStream in;
        Later(String u, String token, String range, String id, long total) { this.u = u; this.token = token; this.range = range; this.id = id; this.total = total; }
        private java.io.InputStream in() throws java.io.IOException {
            if (in == null) {
                java.net.HttpURLConnection c = open(u != null ? u : urlFor(token), range);
                String cr = c.getHeaderField("Content-Range");
                if (c.getResponseCode() != 206 || cr == null || Long.parseLong(cr.substring(cr.indexOf('/') + 1)) != total) {
                    c.disconnect(); java.io.File f = kept(id); if (f != null) f.delete();
                    throw new java.io.IOException("not the stream its start was");
                }
                in = c.getInputStream();
            }
            return in;
        }
        @Override public int read() throws java.io.IOException { return in().read(); }
        @Override public int read(byte[] b, int off, int len) throws java.io.IOException { return in().read(b, off, len); }
        @Override public void close() throws java.io.IOException { if (in != null) in.close(); }
    }

    private static WebResourceResponse failed(int code) {
        return new WebResourceResponse("text/plain", "utf-8", code, code == 403 ? "Forbidden" : code == 410 ? "Gone" : "Bad Gateway", null, new ByteArrayInputStream(new byte[0]));
    }


}
