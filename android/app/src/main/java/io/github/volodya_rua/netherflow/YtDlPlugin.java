// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
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
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.locks.ReentrantReadWriteLock;

// Saving for offline: yt-dlp (Python, run by Chaquopy; see src/main/python/nf_dl.py) downloads a song's audio from
// its YouTube upload, as YouTube has it. The page reads the file (convertFileSrc), keeps it, and has it removed.
//   download({ id, key }) → { path, ext, dur }   ·   events "progress" { key, frac }
//   cancel({ key })   ·   remove({ path })   ·   setUpdates({ on })   ·   file({ url, key }): a podcast's own file (below)
//   stream({ id }) → { url, mime }: FlowStream's fallback, a stream's address (below)
// Only if the user turns on "Update the downloader" (setUpdates; off till the page says so): yt-dlp looks for a newer
// release of itself once a day, and when a download fails (YouTube changes things). Off, it's the one in the app.
@CapacitorPlugin(name = "YtDl")
public class YtDlPlugin extends Plugin {
    private static final long DAY = 24 * 3600_000L, RETRY_AFTER = 6 * 3600_000L;
    private final ExecutorService worker = Executors.newFixedThreadPool(3); // the page downloads three at once
    // downloads share this; making ready or updating yt-dlp (which re-imports it) has it alone
    private final ReentrantReadWriteLock ytdl = new ReentrantReadWriteLock();
    private final Map<String, Boolean> cancelled = new ConcurrentHashMap<>();
    private volatile boolean updates; // the user's "Update the downloader"

    private PyObject py() {
        if (!Python.isStarted()) Python.start(new AndroidPlatform(getContext()));
        return Python.getInstance().getModule("nf_dl");
    }

    private File outDir() {
        File dir = new File(getContext().getCacheDir(), "dl");
        dir.mkdirs();
        return dir;
    }

    private void alone(Runnable r) { // (in the background, with no download running)
        worker.execute(() -> {
            ytdl.writeLock().lock();
            try { r.run(); }
            catch (Exception ignored) {}
            finally { ytdl.writeLock().unlock(); }
        });
    }

    private double sinceChecked() {
        return System.currentTimeMillis() - py().callAttr("checked_at").toDouble() * 1000;
    }

    @Override
    public void load() {
        alone(() -> py().callAttr("prepare")); // (before anything's asked for)
    }

    @PluginMethod
    public void setUpdates(PluginCall call) {
        updates = call.getBoolean("on", false);
        // (each asks again when it runs: switched on and off quickly, the last word counts)
        if (updates) alone(() -> { if (updates && sinceChecked() > DAY) py().callAttr("update"); });
        else alone(() -> { if (!updates) py().callAttr("forget"); });
        call.resolve();
    }

    // what the page calls back with: how far it's got, and whether to stop
    public class Listener {
        private final String key;
        Listener(String key) { this.key = key; }
        public void progress(double frac) {
            JSObject m = new JSObject();
            m.put("key", key); m.put("frac", frac);
            notifyListeners("progress", m);
        }
        public boolean cancelled() { return cancelled.containsKey(key); }
    }

    private boolean update() {
        ytdl.writeLock().lock();
        try { return py().callAttr("update").toBoolean(); }
        finally { ytdl.writeLock().unlock(); }
    }

    private JSObject fetch(String id, String key) {
        List<PyObject> r;
        ytdl.readLock().lock();
        try { r = py().callAttr("download", id, outDir().getAbsolutePath(), key, new Listener(key)).asList(); }
        finally { ytdl.readLock().unlock(); }
        String path = r.get(0).toString();
        JSObject out = new JSObject();
        out.put("path", path);
        out.put("ext", path.substring(path.lastIndexOf('.') + 1));
        out.put("dur", r.get(1).toDouble());
        return out;
    }

    // FlowStream's fallback (when it can't find a song's stream itself): the best audio stream's address, from yt-dlp,
    // nothing downloaded. Python stays loaded between songs.   stream({ id }) → { url, mime }
    @PluginMethod
    public void stream(PluginCall call) {
        String id = call.getString("id", "");
        if (!id.matches("[\\w-]{11}")) { call.reject("bad request"); return; }
        worker.execute(() -> {
            ytdl.readLock().lock();
            try {
                List<PyObject> r = py().callAttr("stream", id).asList();
                JSObject o = new JSObject();
                o.put("url", r.get(0).toString());
                o.put("mime", r.get(1).toString());
                call.resolve(o);
            } catch (Exception e) {
                call.reject(message(e));
            } finally {
                ytdl.readLock().unlock();
            }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        String id = call.getString("id", ""), key = call.getString("key", "");
        if (!id.matches("[\\w-]{11}") || !key.matches("\\w+")) { call.reject("bad request"); return; }
        worker.execute(() -> {
            try {
                JSObject r;
                try { r = fetch(id, key); }
                catch (Exception e) {
                    // maybe YouTube changed something: a newer yt-dlp (looked for at most every 6 hours), then once more
                    if (!updates || cancelled.containsKey(key) || sinceChecked() < RETRY_AFTER || !update()) throw e;
                    r = fetch(id, key);
                }
                call.resolve(r);
            } catch (Exception e) {
                File[] left = outDir().listFiles((d, name) -> name.startsWith(key + ".")); // (nothing kept of a download that didn't finish)
                if (left != null) for (File f : left) f.delete();
                call.reject(cancelled.containsKey(key) ? "cancelled" : message(e));
            } finally {
                cancelled.remove(key);
            }
        });
    }

    // A podcast episode's or audiobook chapter's own file, as its host has it (no yt-dlp: it's a plain file). Redirects
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

    // yt-dlp's own words for what went wrong (its last "ERROR: …" line), without the Python traceback
    private static String message(Exception e) {
        String m = String.valueOf(e.getMessage()), last = null;
        for (String line : m.split("\n")) if (line.contains("ERROR:")) last = line;
        if (last == null) { String[] lines = m.trim().split("\n"); last = lines[lines.length - 1]; }
        return last.replaceAll("^.*?ERROR:\\s*(\\[[^\\]]*\\]\\s*)?", "").trim();
    }
}
