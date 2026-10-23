// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.Manifest;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.session.MediaControllerCompat;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

// Bridge between the page and the song notification (PlaybackService):
//  - the page calls Playback.update({ title, artist, album, art, duration, position, playing, hasNext, lyric }) on every
//    change (lyric: the line being sung, with lyrics on the lock screen on; "" otherwise);
//  - presses on the notification, lock screen, headphones or Bluetooth come back as "action" events — and a car's
//    picks too: "playId" (text: the song's id in the library it was shown) and "search" (text: what was said);
//  - Playback.library({ json }): the library a car shows (see PlaybackService).
@CapacitorPlugin(name = "Playback")
public class PlaybackPlugin extends Plugin {

    private static PlaybackPlugin instance;
    private boolean askedForNotifications = false;

    @Override
    public void load() {
        instance = this;
        watchRoute();
        // a car's pick that opened the app (PlaybackService.startItself): to the page as soon as it listens
        String a = PlaybackService.waitingAction;
        if (a != null) {
            JSObject d = new JSObject(); d.put("action", a); d.put("position", 0); d.put("text", PlaybackService.waitingText);
            PlaybackService.waitingAction = null;
            notifyListeners("action", d, true);
        }
    }
    static boolean alive() { PlaybackPlugin p = instance; return p != null && p.getActivity() != null && !p.getActivity().isFinishing(); }

    // Settings › Start by itself in the car: whether it may ({ on }), and the phone's own switch for it ("Display over
    // other apps" for NetherFlow: see PlaybackService.startItself)
    @PluginMethod
    public void selfStart(PluginCall call) {
        JSObject o = new JSObject();
        o.put("on", Build.VERSION.SDK_INT < 23 || android.provider.Settings.canDrawOverlays(getContext()));
        call.resolve(o);
    }
    @PluginMethod
    public void allowSelfStart(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:" + getContext().getPackageName())));
            call.resolve();
        } catch (RuntimeException e) { call.reject("no settings page"); }
    }
    // Android Auto's own settings (its developer settings are reached from there: see Settings › Android Auto)
    @PluginMethod
    public void carSettings(PluginCall call) {
        String aa = "com.google.android.projection.gearhead";
        for (Intent i : new Intent[] { new Intent(Intent.ACTION_APPLICATION_PREFERENCES).setPackage(aa), getContext().getPackageManager().getLaunchIntentForPackage(aa),
                new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", aa, null)) }) {
            if (i == null) continue;
            try { getActivity().startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); call.resolve(); return; } catch (RuntimeException ignored) {}
        }
        call.reject("no Android Auto");
    }

    // The car, and what the sound comes out of, as they change ("route" events; route() asks): Android Auto running (its
    // own answer — the connection provider Android Auto keeps, as androidx.car.app reads it) and the outputs connected:
    // Bluetooth (by its name), a cable (AUX, headphones), USB. { car, bt, wired, usb, added: what was just connected —
    // "bt", "wired" or "usb" — or "" }. No permission needed.
    private static final android.net.Uri CAR = android.net.Uri.parse("content://androidx.car.app.connection");
    private boolean primed = false;
    static int carState(android.content.Context c) {
        try (android.database.Cursor q = c.getContentResolver().query(CAR, new String[] { "CarConnectionState" }, null, null, null)) {
            if (q != null && q.moveToNext()) return q.getInt(0);
        } catch (Exception ignored) {}
        return 0; // (no Android Auto, or not connected)
    }
    private static String kind(android.media.AudioDeviceInfo d) {
        switch (d.getType()) {
            case android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: return "bt";
            case android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET: case android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case android.media.AudioDeviceInfo.TYPE_LINE_ANALOG: case android.media.AudioDeviceInfo.TYPE_AUX_LINE: return "wired";
            case android.media.AudioDeviceInfo.TYPE_USB_HEADSET: case android.media.AudioDeviceInfo.TYPE_USB_DEVICE: return "usb";
            default: return "";
        }
    }
    private JSObject routeNow(String added) {
        JSObject o = new JSObject();
        String bt = ""; boolean wired = false, usb = false;
        android.media.AudioManager am = getContext().getSystemService(android.media.AudioManager.class);
        if (am != null) for (android.media.AudioDeviceInfo d : am.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS)) {
            String k = kind(d);
            if (k.equals("bt")) bt = String.valueOf(d.getProductName()); else if (k.equals("wired")) wired = true; else if (k.equals("usb")) usb = true;
        }
        o.put("car", carState(getContext()) != 0); o.put("bt", bt); o.put("wired", wired); o.put("usb", usb); o.put("added", added);
        return o;
    }
    private void tellRoute(String added) { notifyListeners("route", routeNow(added)); }
    private void watchRoute() {
        android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
        android.media.AudioManager am = getContext().getSystemService(android.media.AudioManager.class);
        if (am != null) am.registerAudioDeviceCallback(new android.media.AudioDeviceCallback() {
            @Override public void onAudioDevicesAdded(android.media.AudioDeviceInfo[] add) {
                String k = "";
                for (android.media.AudioDeviceInfo d : add) if (d.isSink() && !kind(d).isEmpty()) k = kind(d);
                tellRoute(primed ? k : ""); primed = true; // (the first call: what was there already, not just connected)
            }
            @Override public void onAudioDevicesRemoved(android.media.AudioDeviceInfo[] gone) { tellRoute(""); }
        }, h);
        // Android Auto starting or ending: its provider's change, and the word it sends apps as it does
        try { getContext().getContentResolver().registerContentObserver(CAR, true, new android.database.ContentObserver(h) { @Override public void onChange(boolean self) { tellRoute(""); } }); } catch (Exception ignored) {}
        ContextCompat.registerReceiver(getContext(), new android.content.BroadcastReceiver() {
            @Override public void onReceive(android.content.Context c, Intent i) { h.postDelayed(() -> tellRoute(""), 500); } // (only asks again: nothing's taken from it)
        }, new android.content.IntentFilter("androidx.car.app.connection.action.CAR_CONNECTION_UPDATED"), ContextCompat.RECEIVER_EXPORTED);
    }
    @PluginMethod
    public void route(PluginCall call) { call.resolve(routeNow("")); }

    @PluginMethod
    public void update(PluginCall call) {
        // Android 13+ needs permission to show the notification (the music plays either way); ask once.
        if (Build.VERSION.SDK_INT >= 33 && !askedForNotifications
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askedForNotifications = true;
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7);
        }
        Bundle song = new Bundle();
        song.putString("title", call.getString("title", "NetherFlow"));
        song.putString("artist", call.getString("artist", ""));
        song.putString("album", call.getString("album", ""));
        song.putString("art", call.getString("art", ""));
        song.putLong("duration", call.getDouble("duration", 0.0).longValue());
        song.putLong("position", call.getDouble("position", 0.0).longValue());
        song.putBoolean("playing", call.getBoolean("playing", false));
        song.putBoolean("hasNext", call.getBoolean("hasNext", false));
        song.putString("lyric", call.getString("lyric", ""));
        getActivity().runOnUiThread(() -> {
            if (PlaybackService.instance != null) PlaybackService.instance.update(song);
            // (Android 12+ refuses a foreground service started from the background — the service ended while the app was
            // away: no notification till the app's in front again, rather than the app crashing)
            else try { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), PlaybackService.class).putExtras(song)); } catch (RuntimeException ignored) {}
        });
        call.resolve();
    }

    // Whether the phone lets the app run freely in the background ({ free }): a phone saving battery may stop it there,
    // song and all (the page tells the user, once, with the way to change it — see appSettings)
    @PluginMethod
    public void battery(PluginCall call) {
        android.os.PowerManager pm = getContext().getSystemService(android.os.PowerManager.class);
        JSObject out = new JSObject();
        out.put("free", pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(out);
    }

    // whether any app's music is sounding now, or a call's on ({ on }): the page waits for it to be over to carry on a song
    // another app's sound paused (no app named: Android only says whether)
    @PluginMethod
    public void musicActive(PluginCall call) {
        android.media.AudioManager am = getContext().getSystemService(android.media.AudioManager.class);
        JSObject out = new JSObject();
        out.put("on", am != null && (am.isMusicActive() || am.getMode() != android.media.AudioManager.MODE_NORMAL));
        call.resolve(out);
    }

    // MobiVib: the phone's vibration motor, a stretch of the music's vibration at a time ({ t: each step's ms, a: each one's
    // strength 0–255 }) — what it was doing replaced by it (the page sends what's still to come, so it runs on without a
    // gap). As music's (the phone's own Media vibration setting has the last word). A motor that can't set its strength:
    // each 10 ms of a step on or off in turn, as often on as it's strong (the motor's own slowness smooths it).
    @PluginMethod
    public void vibeWave(PluginCall call) {
        android.os.Vibrator v = Build.VERSION.SDK_INT >= 31 ? getContext().getSystemService(android.os.VibratorManager.class).getDefaultVibrator() : getContext().getSystemService(android.os.Vibrator.class);
        JSArray ts = call.getArray("t"), as = call.getArray("a");
        if (v == null || !v.hasVibrator() || ts == null || as == null || ts.length() != as.length() || ts.length() == 0 || ts.length() > 400 || Build.VERSION.SDK_INT < 26) { call.resolve(); return; }
        try {
            boolean strength = v.hasAmplitudeControl();
            java.util.List<Long> t = new ArrayList<>(); java.util.List<Integer> a = new ArrayList<>();
            double owe = 0;
            for (int i = 0; i < ts.length(); i++) {
                long ms = Math.max(0, Math.min(5000, ts.getLong(i))); int amp = Math.max(0, Math.min(255, as.getInt(i)));
                if (strength) { t.add(ms); a.add(amp); continue; }
                for (long left = ms; left > 0; left -= 10) { owe += amp / 255.0; boolean on = owe >= .5; if (on) owe -= 1; t.add(Math.min(10, left)); a.add(on ? 255 : 0); }
            }
            long[] tt = new long[t.size()]; int[] aa = new int[a.size()];
            for (int i = 0; i < tt.length; i++) { tt[i] = t.get(i); aa[i] = a.get(i); }
            android.os.VibrationEffect e = android.os.VibrationEffect.createWaveform(tt, aa, -1);
            if (Build.VERSION.SDK_INT >= 33) v.vibrate(e, android.os.VibrationAttributes.createForUsage(android.os.VibrationAttributes.USAGE_MEDIA));
            else v.vibrate(e, new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_MEDIA).setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC).build());
        } catch (Exception ignored) {}
        call.resolve();
    }

    // the app's own page in the phone's settings (Battery › Unrestricted, there, lets it play on in the background)
    @PluginMethod
    public void appSettings(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", getContext().getPackageName(), null)));
            call.resolve();
        } catch (RuntimeException e) { call.reject("no settings page"); }
    }

    // the home-screen widget, put there from the app: the phone's own question, where to (where it lets apps ask — { asked })
    @PluginMethod
    public void pinWidget(PluginCall call) {
        android.appwidget.AppWidgetManager m = android.appwidget.AppWidgetManager.getInstance(getContext());
        JSObject out = new JSObject();
        out.put("asked", Build.VERSION.SDK_INT >= 26 && m.isRequestPinAppWidgetSupported()
            && m.requestPinAppWidget(new ComponentName(getContext(), NowPlayingWidget.class), null, null));
        call.resolve(out);
    }

    @PluginMethod
    public void library(PluginCall call) {
        PlaybackService.setLibrary(getContext(), call.getString("json", "{}"));
        call.resolve();
    }

    // (a debug build only: what a car sees — the library's tree, as a media browser gets it — and, given one, a song asked
    // for the way a car asks)
    @PluginMethod
    public void carCheck(PluginCall call) {
        if ((getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) { call.reject("debug builds only"); return; }
        String play = call.getString("play", "");
        getActivity().runOnUiThread(() -> {
            MediaBrowserCompat[] b = new MediaBrowserCompat[1];
            b[0] = new MediaBrowserCompat(getContext(), new ComponentName(getContext(), PlaybackService.class), new MediaBrowserCompat.ConnectionCallback() {
                @Override public void onConnected() {
                    JSObject out = new JSObject();
                    out.put("root", b[0].getRoot());
                    // (who'd be shown the library: Android Auto and Google's app as installed; Android Auto's name from
                    // an app it isn't — a uid with no such package — refused)
                    JSObject who = new JSObject();
                    PlaybackService s = PlaybackService.instance;
                    for (String p : new String[] { "com.google.android.projection.gearhead", "com.google.android.googlequicksearchbox" }) {
                        try { who.put(p, s != null && s.trusted(p, getContext().getPackageManager().getApplicationInfo(p, 0).uid)); } catch (Exception e) { who.put(p, "not seen"); }
                    }
                    who.put("gearhead's name, another app", s != null && s.trusted("com.google.android.projection.gearhead", 99999));
                    out.put("trusted", who);
                    load(b[0], b[0].getRoot(), out, 3, () -> {
                        if (!play.isEmpty()) new MediaControllerCompat(getContext(), b[0].getSessionToken()).getTransportControls().playFromMediaId(play, null);
                        b[0].disconnect();
                        call.resolve(out);
                    });
                }
                @Override public void onConnectionFailed() { call.reject("couldn't connect"); }
            }, null);
            b[0].connect();
        });
    }
    private void load(MediaBrowserCompat b, String id, JSObject out, int depth, Runnable done) {
        b.subscribe(id, new MediaBrowserCompat.SubscriptionCallback() {
            @Override public void onChildrenLoaded(@NonNull String parent, @NonNull List<MediaBrowserCompat.MediaItem> children) {
                b.unsubscribe(parent);
                JSArray list = new JSArray();
                List<String> deeper = new ArrayList<>();
                for (MediaBrowserCompat.MediaItem m : children) {
                    JSObject o = new JSObject();
                    o.put("id", m.getMediaId()); o.put("title", String.valueOf(m.getDescription().getTitle())); o.put("sub", String.valueOf(m.getDescription().getSubtitle())); o.put("browsable", m.isBrowsable());
                    list.put(o);
                    if (m.isBrowsable() && depth > 1) deeper.add(m.getMediaId());
                }
                out.put(parent, list);
                if (deeper.isEmpty()) { done.run(); return; }
                int[] left = { deeper.size() };
                for (String d : deeper) load(b, d, out, depth - 1, () -> { if (--left[0] == 0) done.run(); });
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null; // (the page gone: a car's pick can't be played — PlaybackService says so)
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    static void emit(String action, long position) { emit(action, position, ""); }
    // (false: no page to tell)
    static boolean emit(String action, long position, String text) {
        PlaybackPlugin p = instance;
        if (p == null || p.getActivity() == null || p.getActivity().isFinishing()) return false;
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("position", position);
        data.put("text", text);
        p.notifyListeners("action", data);
        return true;
    }
}
