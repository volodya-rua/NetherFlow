// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Keeps the page clear of the status bar, navigation bar, camera cutout and keyboard, and
// gives the page's full-screen button a real full screen: the bars hide and the page also
// fills the strip they and the camera cutout used. Swiping in from an edge shows the bars
// briefly, the usual Android behaviour. (Capacitor's own SystemBars insets handling is
// switched off in capacitor.config.json; it kept the cutout strip padded in full screen.)
@CapacitorPlugin(name = "Immersive")
public class ImmersivePlugin extends Plugin {
    private static final int EDGES = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
    private boolean full = false;
    // The frames Android has drawn (the page and all) since the page last asked: on Android the page's own frame clock
    // runs on even when the screen can't keep up, so it can't tell its real speed by itself.
    private int frames = 0, slow = 0; // slow: frames that came 45 ms or more after the one before (two or more skipped: a stutter)
    private long lastVsync = 0;
    private long since = System.nanoTime();

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            WindowCompat.setDecorFitsSystemWindows(w, false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams a = w.getAttributes();
                a.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                w.setAttributes(a);
            }
            View decor = w.getDecorView();
            ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
                Insets e = insets.getInsets(EDGES);
                int ime = insets.isVisible(WindowInsetsCompat.Type.ime()) ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
                if (full) v.setPadding(0, 0, 0, ime);
                else v.setPadding(e.left, e.top, e.right, Math.max(ime, e.bottom));
                // the page itself never needs to step around anything
                return new WindowInsetsCompat.Builder(insets).setInsets(EDGES, Insets.NONE).build();
            });
            ViewCompat.requestApplyInsets(decor);
            HandlerThread counter = new HandlerThread("frame-count");
            counter.start();
            w.addOnFrameMetricsAvailableListener((win, metrics, dropped) -> {
                // (the gap since the frame before, by when each was meant to start — over a quarter second, the page was
                // resting, not stuttering; Android 8 and up)
                long at = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? metrics.getMetric(android.view.FrameMetrics.INTENDED_VSYNC_TIMESTAMP) : 0;
                synchronized (this) {
                    long gap = at - lastVsync;
                    if (at > 0 && lastVsync > 0 && gap >= 45_000_000L && gap < 250_000_000L) slow++;
                    lastVsync = at; frames += 1 + dropped;
                }
            }, new Handler(counter.getLooper()));
        });
    }

    // How many frames a second were really drawn since the last ask, and the share of them that stuttered (the page steps
    // its own quality down by these).
    @PluginMethod
    public void frameRate(PluginCall call) {
        JSObject r = new JSObject();
        synchronized (this) {
            long now = System.nanoTime();
            r.put("fps", frames / Math.max(.001, (now - since) / 1e9));
            r.put("janky", frames > 0 ? (double) slow / frames : 0);
            frames = 0; slow = 0; since = now;
        }
        call.resolve(r);
    }

    // The screen stays on while a song plays (the page asks; only while the app is on screen, as Android does it).
    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    // a TV (Android TV, Google TV, a TV box): the page is worked with the remote's arrows → { tv }
    @PluginMethod
    public void tv(PluginCall call) {
        android.app.UiModeManager ui = (android.app.UiModeManager) getContext().getSystemService(android.content.Context.UI_MODE_SERVICE);
        JSObject r = new JSObject();
        r.put("tv", ui != null && ui.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
            || getContext().getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK));
        call.resolve(r);
    }

    @PluginMethod
    public void enter(PluginCall call) { setFull(true); call.resolve(); }

    @PluginMethod
    public void exit(PluginCall call) { setFull(false); call.resolve(); }

    private void setFull(boolean on) {
        getActivity().runOnUiThread(() -> {
            full = on;
            Window w = getActivity().getWindow();
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(w, w.getDecorView());
            if (on) {
                bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                bars.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                bars.show(WindowInsetsCompat.Type.systemBars());
            }
            ViewCompat.requestApplyInsets(w.getDecorView());
        });
    }
}
