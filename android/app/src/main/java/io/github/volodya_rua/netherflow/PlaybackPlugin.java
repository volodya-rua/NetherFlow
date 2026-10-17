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
