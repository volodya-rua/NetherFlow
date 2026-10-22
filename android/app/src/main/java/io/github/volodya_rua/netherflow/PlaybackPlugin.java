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
    }

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
