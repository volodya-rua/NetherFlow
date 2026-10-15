// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.spec.X509EncodedKeySpec;
import java.util.Iterator;
import org.json.JSONArray;
import org.json.JSONObject;

// Updates (the page's Settings › Update), for NetherFlow's own APK from its GitHub releases — not for one from an app store
// (F-Droid builds and signs its own, and updates it itself): there, `ours` is false and nothing here runs.
//   info() → { name, code (this APK's), web (the page's version in use), ours }
//   web({ manifest, sig }) — a newer page: the manifest (signed by NetherFlow's developer: checked against KEY below)
//     lists every file of it with its SHA-256; those unchanged are copied from the page in use, only the changed ones
//     downloaded (each checked), into a folder of their own; the app then loads its page from there, from now on (till
//     a newer APK is installed, which brings its own: Capacitor goes back to that by itself). Events "progress" { frac }.
//   apk({ url, sha256 }) — a newer APK (when a release changed the app around the page): downloaded, checked, and handed
//     to Android's installer (which only takes it if it's signed with the same key as this one).
@CapacitorPlugin(name = "Updater")
public class UpdatePlugin extends Plugin {
    // the developer's public key for update manifests (ECDSA P-256); the private one never leaves the developer's computer
    private static final String KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErQ2sAogccQxwbWXzsONYvsTvUAzByGuOo0mbbIwx4Zo+jSzdHOzz4K05sNl/xLqIH6nl3DFlMEsOeBr143V6sw==";
    // the certificate NetherFlow's own APKs are signed with (SHA-256)
    private static final String CERT = "2e840b179a4efa67760e2a634db8e5af0c0a504eb0003989984eef17dd2a039e";
    private static final String CAP_PREFS = "CapWebViewSettings", CAP_PATH = "serverBasePath"; // (Capacitor's own: see its WebView plugin)

    private SharedPreferences prefs() { return getContext().getSharedPreferences("nfUpdate", Context.MODE_PRIVATE); }

    private PackageInfo pkg() throws Exception {
        PackageManager pm = getContext().getPackageManager();
        return pm.getPackageInfo(getContext().getPackageName(), Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES);
    }

    private static long code(PackageInfo p) { return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode; }

    private boolean ours(PackageInfo p) throws Exception {
        if ((getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) return true; // (a build of one's own, testing)
        android.content.pm.Signature[] sigs = Build.VERSION.SDK_INT >= 28 ? p.signingInfo.getApkContentsSigners() : p.signatures;
        for (android.content.pm.Signature s : sigs) if (hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())).equals(CERT)) return true;
        return false;
    }

    // the page in use: the one put in place by web(), while Capacitor still loads it; else the one in this APK
    private File current() {
        String path = getContext().getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE).getString(CAP_PATH, "");
        String mine = prefs().getString("dir", "");
        return !path.isEmpty() && path.equals(mine) && new File(path).isDirectory() ? new File(path) : null;
    }

    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo p = pkg();
            JSObject r = new JSObject();
            r.put("name", p.versionName); r.put("code", code(p)); r.put("ours", ours(p));
            r.put("web", current() != null ? prefs().getString("web", p.versionName) : p.versionName);
            call.resolve(r);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void web(PluginCall call) {
        String manifest = call.getString("manifest", ""), sig = call.getString("sig", "");
        new Thread(() -> {
            try {
                PackageInfo p = pkg();
                if (!ours(p)) throw new Exception("updates come from the store this app came from");
                java.security.Signature v = java.security.Signature.getInstance("SHA256withECDSA");
                v.initVerify(KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(Base64.decode(KEY, Base64.DEFAULT))));
                v.update(manifest.getBytes(StandardCharsets.UTF_8));
                if (!v.verify(Base64.decode(sig, Base64.DEFAULT))) throw new Exception("the update isn't signed by NetherFlow's developer");
                JSONObject m = new JSONObject(manifest);
                String version = m.getString("version"), base = m.getString("base");
                if (!version.matches("\\d+(\\.\\d+){1,3}") || !base.startsWith("https://raw.githubusercontent.com/volodya-rua/NetherFlow/")) throw new Exception("a strange update");
                if (m.getLong("min") > code(p)) throw new Exception("this update needs the new app");
                JSONObject files = m.getJSONObject("files");
                long total = 0, done = 0;
                for (Iterator<String> it = files.keys(); it.hasNext(); ) total += files.getJSONArray(it.next()).getLong(1);
                File root = new File(getContext().getFilesDir(), "web"), dir = new File(root, version), from = current();
                deleteAll(dir);
                for (Iterator<String> it = files.keys(); it.hasNext(); ) {
                    String path = it.next();
                    JSONArray f = files.getJSONArray(path);
                    if (!path.matches("[\\w.-]+(/[\\w.-]+)*") || path.contains("..")) throw new Exception("a strange file in the update");
                    File out = new File(dir, path);
                    out.getParentFile().mkdirs();
                    // (the same file as the page in use: copied from it; else downloaded)
                    boolean have = false;
                    try (InputStream in = from != null ? new FileInputStream(new File(from, path)) : getContext().getAssets().open("public/" + path)) { have = f.getString(0).equals(save(in, out)); } catch (Exception ignored) {}
                    if (!have) {
                        HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection();
                        c.setConnectTimeout(15000); c.setReadTimeout(30000);
                        try (InputStream in = c.getInputStream()) { if (!f.getString(0).equals(save(in, out))) throw new Exception(path + " didn't arrive whole"); } finally { c.disconnect(); }
                    }
                    done += f.getLong(1);
                    JSObject ev = new JSObject(); ev.put("frac", total > 0 ? (double) done / total : 1); notifyListeners("progress", ev);
                }
                // in place: the page from this folder from now on (the next start, and right now)
                prefs().edit().putString("web", version).putString("dir", dir.getAbsolutePath()).apply();
                getContext().getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE).edit().putString(CAP_PATH, dir.getAbsolutePath()).apply();
                File[] old = root.listFiles();
                if (old != null) for (File o : old) if (!o.equals(dir)) deleteAll(o);
                call.resolve();
                getActivity().runOnUiThread(() -> getBridge().setServerBasePath(dir.getAbsolutePath()));
            } catch (Exception e) { call.reject(e.getMessage() != null ? e.getMessage() : "the update failed"); }
        }).start();
    }

    @PluginMethod
    public void apk(PluginCall call) {
        String url = call.getString("url", ""), sha = call.getString("sha256", "");
        new Thread(() -> {
            try {
                if (!ours(pkg())) throw new Exception("updates come from the store this app came from");
                if (!url.startsWith("https://github.com/volodya-rua/NetherFlow/releases/")) throw new Exception("a strange update");
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) { // (Android asks once: may NetherFlow install apps?)
                    getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
                    throw new Exception("allow NetherFlow to install updates, then try again");
                }
                File out = new File(getContext().getCacheDir(), "update.apk");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15000); c.setReadTimeout(30000);
                String got;
                try (InputStream in = c.getInputStream()) {
                    long total = c.getContentLengthLong();
                    got = save(in, out, total);
                } finally { c.disconnect(); }
                if (!sha.isEmpty() && !sha.equals(got)) throw new Exception("the download didn't arrive whole");
                Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out), "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(i);
                call.resolve();
            } catch (Exception e) { call.reject(e.getMessage() != null ? e.getMessage() : "the update failed"); }
        }).start();
    }

    // a stream into a file → its SHA-256 (progress events as it comes, when its length is known)
    private String save(InputStream in, File out) throws Exception { return save(in, out, -1); }
    private String save(InputStream in, File out, long total) throws Exception {
        MessageDigest d = MessageDigest.getInstance("SHA-256");
        byte[] b = new byte[65536];
        long n = 0, step = 0;
        try (OutputStream o = new FileOutputStream(out)) {
            for (int k; (k = in.read(b)) > 0; ) {
                o.write(b, 0, k); d.update(b, 0, k); n += k;
                if (total > 0 && n - step > total / 50) { step = n; JSObject ev = new JSObject(); ev.put("frac", (double) n / total); notifyListeners("progress", ev); }
            }
        }
        return hex(d.digest());
    }

    private static String hex(byte[] b) { StringBuilder s = new StringBuilder(); for (byte x : b) s.append(String.format("%02x", x)); return s.toString(); }

    private static void deleteAll(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteAll(k);
        f.delete();
    }
}
