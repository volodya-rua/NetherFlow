// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// Saving a podcast episode or audiobook chapter for offline: its own file, downloaded by the phone (their hosts don't
// let a page read them). The page reads the file (convertFileSrc), keeps it, and has it removed.
//   file({ url, key }) → { path, type }   ·   events "progress" { key, frac }   ·   cancel({ key })   ·   remove({ path })
// (Songs are saved by FlowStream, in the page.)
@CapacitorPlugin(name = "Files")
public class FilesPlugin extends Plugin {
    private final ExecutorService worker = Executors.newFixedThreadPool(3); // the page downloads three at once
    private final Map<String, Boolean> cancelled = new ConcurrentHashMap<>();

    private File outDir() {
        File dir = new File(getContext().getCacheDir(), "dl");
        dir.mkdirs();
        return dir;
    }

    // what the page is told: how far it's got; and whether to stop
    private class Listener {
        private final String key;
        Listener(String key) { this.key = key; }
        void progress(double frac) {
            JSObject m = new JSObject();
            m.put("key", key); m.put("frac", frac);
            notifyListeners("progress", m);
        }
        boolean cancelled() { return cancelled.containsKey(key); }
    }

    // A podcast episode's or audiobook chapter's own file, as its host has it. Redirects
    // followed by hand, so http → https ones (podcast hosts' trackers) work too; everything asked of https.
    //   file({ url, key }) → { path, type }   ·   events "progress" { key, frac }   ·   cancel({ key })
    @PluginMethod
    public void file(PluginCall call) {
        String url = call.getString("url", ""), key = call.getString("key", "");
        if (!url.matches("https?://\\S+") || !key.matches("\\w+")) { call.reject("bad request"); return; }
        cancelled.remove(key); // (a Stop that came after an earlier download of it had ended: not this one's)
        worker.execute(() -> {
            File out = new File(outDir(), key + ".audio");
            Listener tell = new Listener(key);
            HttpURLConnection c = null;
            try {
                String at = url;
                for (int hop = 0; ; hop++) {
                    c = (HttpURLConnection) new URL(at.replaceFirst("^http:", "https:")).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000); c.setReadTimeout(30000);
                    c.setRequestProperty("User-Agent", "NetherFlow/1 (podcasts; +https://github.com/volodya-rua/NetherFlow)");
                    int code = c.getResponseCode();
                    String to = c.getHeaderField("Location");
                    if (code < 300 || code > 399 || to == null) break;
                    if (hop == 10) throw new Exception("it kept being sent elsewhere");
                    at = new URL(new URL(at), to).toString();
                    c.disconnect();
                }
                if (c.getResponseCode() != 200) throw new Exception("its host answered " + c.getResponseCode());
                long size = c.getContentLengthLong(), got = 0, told = 0;
                byte[] buf = new byte[64 * 1024];
                try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(out)) {
                    for (int n; (n = in.read(buf)) > 0; ) {
                        if (tell.cancelled()) throw new Exception("cancelled");
                        o.write(buf, 0, n);
                        got += n;
                        if (size > 0 && got - told > size / 100) { told = got; tell.progress((double) got / size); }
                    }
                }
                if (size > 0 && got < size) throw new Exception("it didn't arrive whole");
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                String type = c.getContentType();
                r.put("type", type == null ? "" : type.split(";")[0].trim());
                call.resolve(r);
            } catch (Exception e) {
                out.delete();
                call.reject(cancelled.containsKey(key) ? "cancelled" : e instanceof java.net.UnknownHostException ? "no connection" : String.valueOf(e.getMessage()));
            } finally {
                if (c != null) c.disconnect();
                cancelled.remove(key);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled.put(call.getString("key", ""), true);
        call.resolve();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        File f = new File(call.getString("path", ""));
        if (outDir().equals(f.getParentFile())) f.delete(); // (only its own downloads)
        call.resolve();
    }

    // A request whose answer reaches the page as it was sent: compressed (gzip, when the server does), in base64. A long
    // playlist's pages (megabytes of text each) cross into the page about fifteen times smaller than the native HTTP's
    // text answers do — and that crossing, not the network, is what's slow. The page unpacks it.
    //   packed({ url, method: GET|POST, headers, body }) → { status, encoding, data }
    private final ExecutorService net = Executors.newFixedThreadPool(4); // (a long list's pages: four at once)

    @PluginMethod
    public void packed(PluginCall call) {
        String url = call.getString("url", ""), method = call.getString("method", "GET"), body = call.getString("body", null);
        JSObject headers = call.getObject("headers", new JSObject());
        if (!url.matches("https://\\S+") || !method.matches("GET|POST")) { call.reject("bad request"); return; }
        net.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod(method);
                c.setConnectTimeout(8000);
                c.setReadTimeout(15000);
                for (java.util.Iterator<String> k = headers.keys(); k.hasNext(); ) { String n = k.next(); c.setRequestProperty(n, headers.getString(n)); }
                c.setRequestProperty("Accept-Encoding", "gzip"); // (asked for by name: handed over as it comes, not unpacked here)
                if (body != null) {
                    c.setDoOutput(true);
                    try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
                }
                int status = c.getResponseCode();
                java.io.ByteArrayOutputStream got = new java.io.ByteArrayOutputStream();
                try (InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream()) {
                    if (in != null) {
                        byte[] b = new byte[65536];
                        for (int n; (n = in.read(b)) > 0; ) { got.write(b, 0, n); if (got.size() > 32_000_000) throw new java.io.IOException("too big"); }
                    }
                }
                JSObject r = new JSObject();
                r.put("status", status);
                r.put("encoding", c.getContentEncoding() == null ? "" : c.getContentEncoding());
                r.put("data", android.util.Base64.encodeToString(got.toByteArray(), android.util.Base64.NO_WRAP));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e instanceof java.net.UnknownHostException ? "fetch failed: no connection" : "fetch failed: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

}
