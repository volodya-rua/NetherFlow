// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The phone's own media volume, for the page's volume slider: 0…100% on the slider is the phone's volume
// (the same as its volume keys), and past that the page's booster takes over.
//  - SystemVolume.get() → { level: 0…1, steps, fixed }   (fixed: the phone doesn't let apps change it)
//  - SystemVolume.set({ level: 0…1 })
//  - "change" events { level } when it changes some other way (the volume keys, the system panel…)
@CapacitorPlugin(name = "SystemVolume")
public class SystemVolumePlugin extends Plugin {
    private AudioManager audio;
    private int last = -1;

    @Override
    public void load() {
        audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        last = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        getActivity().setVolumeControlStream(AudioManager.STREAM_MUSIC); // the volume keys: always the media volume
        BroadcastReceiver changed = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int now = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
                if (now == last) return;
                last = now;
                JSObject e = new JSObject();
                e.put("level", now / (double) audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
                notifyListeners("change", e);
            }
        };
        ContextCompat.registerReceiver(getContext(), changed, new IntentFilter("android.media.VOLUME_CHANGED_ACTION"), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @PluginMethod
    public void get(PluginCall call) {
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        JSObject r = new JSObject();
        r.put("level", audio.getStreamVolume(AudioManager.STREAM_MUSIC) / (double) max);
        r.put("steps", max);
        r.put("fixed", audio.isVolumeFixed());
        call.resolve(r);
    }

    @PluginMethod
    public void set(PluginCall call) {
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int to = (int) Math.round(Math.max(0, Math.min(1, call.getDouble("level", 1.0))) * max);
        try {
            if (to != audio.getStreamVolume(AudioManager.STREAM_MUSIC)) audio.setStreamVolume(AudioManager.STREAM_MUSIC, to, 0);
            last = to; // (its own change: not echoed back as a "change" event)
            call.resolve();
        } catch (SecurityException e) { // (Do Not Disturb can refuse it)
            call.reject(e.getMessage());
        }
    }
}
