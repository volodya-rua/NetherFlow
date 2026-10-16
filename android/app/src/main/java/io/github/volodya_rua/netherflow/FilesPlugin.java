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

}
