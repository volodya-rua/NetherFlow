// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Bridge between the page and the song notification (PlaybackService):
//  - the page calls Playback.update({ title, artist, album, art, duration, position, playing, hasNext, lyric }) on every
//    change (lyric: the line being sung, with lyrics on the lock screen on; "" otherwise);
//  - presses on the notification, lock screen, headphones or Bluetooth come back as "action" events.
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
            else ContextCompat.startForegroundService(getContext(), new Intent(getContext(), PlaybackService.class).putExtras(song));
        });
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    static void emit(String action, long position) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("position", position);
        instance.notifyListeners("action", data);
    }
}
