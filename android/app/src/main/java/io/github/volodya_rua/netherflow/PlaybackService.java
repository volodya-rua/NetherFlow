// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.InputStream;
import java.net.URL;

// The song notification, like Spotify's: cover art, title, artist, previous / play-pause / next and a seek bar,
// also on the lock screen and in the quick-settings media player. Its media session takes presses from
// headphones and Bluetooth too (press = play/pause, double press = next, and previous, skip ±10 s and stop
// from headsets that send them). Running it as a foreground service keeps NetherFlow alive in the background.
public class PlaybackService extends Service {

    static PlaybackService instance;
    private static final String CHANNEL = "now_playing";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Bundle song = new Bundle();
    private MediaSessionCompat session;
    private String artUrl = "";
    private Bitmap art, small; // (small: the widget's copy — a widget's picture has to be small)
    private boolean foreground = false;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager.class)
                .createNotificationChannel(new NotificationChannel(CHANNEL, "Now playing", NotificationManager.IMPORTANCE_LOW));
        }
        session = new MediaSessionCompat(this, "NetherFlow");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { PlaybackPlugin.emit("play", 0); }
            @Override public void onPause() { PlaybackPlugin.emit("pause", 0); }
            @Override public void onSkipToNext() { PlaybackPlugin.emit("next", 0); }
            @Override public void onSkipToPrevious() { PlaybackPlugin.emit("prev", 0); }
            @Override public void onSeekTo(long position) { PlaybackPlugin.emit("seek", position); }
            @Override public void onFastForward() { PlaybackPlugin.emit("fwd", 0); }
            @Override public void onRewind() { PlaybackPlugin.emit("back", 0); }
            @Override public void onStop() { PlaybackPlugin.emit("pause", 0); }
        });
        session.setActive(true);
        // Headphones unplugged or Bluetooth disconnected: pause, like other music apps (a system broadcast: it reaches a
        // receiver that isn't exported too, and no other app can send it to pause the music)
        ContextCompat.registerReceiver(this, unplugged, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private final BroadcastReceiver unplugged = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (song.getBoolean("playing")) PlaybackPlugin.emit("pause", 0);
        }
    };

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if ("nf.prev".equals(action)) PlaybackPlugin.emit("prev", 0);
        else if ("nf.next".equals(action)) PlaybackPlugin.emit("next", 0);
        else if ("nf.toggle".equals(action)) PlaybackPlugin.emit(song.getBoolean("playing") ? "pause" : "play", 0);
        else if (intent != null && intent.getExtras() != null) update(intent.getExtras());
        if (!foreground) publish(); // Android requires the notification promptly after the service starts
        return START_NOT_STICKY;
    }

    // New song details from the page (any subset of the fields).
    void update(Bundle changes) {
        song.putAll(changes);
        String url = song.getString("art", "");
        if (!url.equals(artUrl)) {
            artUrl = url;
            art = null; small = null;
            if (!url.isEmpty()) loadArt(url);
        }
        publish();
    }

    private void loadArt(String url) {
        new Thread(() -> {
            Bitmap bmp = null;
            try (InputStream in = new URL(url).openStream()) { bmp = BitmapFactory.decodeStream(in); } catch (Exception ignored) {}
            Bitmap loaded = bmp;
            Bitmap little = loaded == null ? null : Bitmap.createScaledBitmap(loaded, 200, 200 * loaded.getHeight() / Math.max(1, loaded.getWidth()), true);
            main.post(() -> { if (url.equals(artUrl)) { art = loaded; small = little; publish(); } });
        }).start();
    }

    private void publish() {
        boolean playing = song.getBoolean("playing");
        String title = song.getString("title", "NetherFlow"), artist = song.getString("artist", ""), album = song.getString("album", "");
        // (lyrics on the lock screen: the line being sung where the artist goes — under the title there, and on a car's display)
        String lyric = song.getString("lyric", ""), line = lyric.isEmpty() ? artist : lyric;

        session.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, line)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, song.getLong("duration"))
            .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art)
            .build());
        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SEEK_TO | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_FAST_FORWARD | PlaybackStateCompat.ACTION_REWIND | PlaybackStateCompat.ACTION_STOP
            | (song.getBoolean("hasNext") ? PlaybackStateCompat.ACTION_SKIP_TO_NEXT : 0);
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, song.getLong("position"), playing ? 1f : 0f)
            .build());

        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_netherflow)
            .setLargeIcon(art)
            .setContentTitle(title)
            .setContentText(line)
            .setSubText(lyric.isEmpty() ? album : artist)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC) // show controls on the lock screen
            .setOngoing(playing)
            .setSilent(true)
            .addAction(R.drawable.ic_nf_prev, "Previous", press("nf.prev", 1))
            .addAction(playing ? R.drawable.ic_nf_pause : R.drawable.ic_nf_play, playing ? "Pause" : "Play", press("nf.toggle", 2))
            .addAction(R.drawable.ic_nf_next, "Next", press("nf.next", 3))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .build();
        if (!foreground) {
            if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(1, n);
            foreground = true;
        } else {
            getSystemService(NotificationManager.class).notify(1, n);
        }
        NowPlayingWidget.refresh(this, this);
    }

    // (for the widget)
    String title() { return song.getString("title", "NetherFlow"); }
    String subtitle() { String l = song.getString("lyric", ""); return l.isEmpty() ? song.getString("artist", "") : l; }
    boolean isPlaying() { return song.getBoolean("playing"); }
    Bitmap widgetArt() { return small; }

    PendingIntent press(String action, int code) {
        return PendingIntent.getService(this, code, new Intent(this, PlaybackService.class).setAction(action), PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onDestroy() {
        instance = null;
        NowPlayingWidget.refresh(this, null); // (closed: the widget back to "open the app")
        unregisterReceiver(unplugged);
        session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
