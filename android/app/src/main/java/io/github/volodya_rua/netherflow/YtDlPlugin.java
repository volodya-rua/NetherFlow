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
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.locks.ReentrantReadWriteLock;

// Saving for offline: yt-dlp (Python, run by Chaquopy; see src/main/python/nf_dl.py) downloads a song's audio from
// its YouTube upload, as YouTube has it. The page reads the file (convertFileSrc), keeps it, and has it removed.
//   download({ id, key }) → { path, ext, dur }   ·   events "progress" { key, frac }
//   cancel({ key })   ·   remove({ path })   ·   setUpdates({ on })
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
