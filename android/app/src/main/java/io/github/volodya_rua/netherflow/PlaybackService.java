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
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.media.MediaBrowserServiceCompat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

// The song notification, like Spotify's: cover art, title, artist, previous / play-pause / next and a seek bar,
// also on the lock screen and in the quick-settings media player. Its media session takes presses from
// headphones and Bluetooth too (press = play/pause, double press = next, and previous, skip ±10 s and stop
// from headsets that send them). Running it as a foreground service keeps NetherFlow alive in the background.
// It's also the music app a car sees (Android Auto, a car's own media screen): your liked songs, recently played and
// playlists to pick from, and songs and voice searches ("play … on NetherFlow") back to the page, which plays them.
public class PlaybackService extends MediaBrowserServiceCompat {

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
            @Override public void onPlayFromMediaId(String mediaId, Bundle extras) { fromCar("playId", mediaId); }
            @Override public void onPlayFromSearch(String query, Bundle extras) { fromCar("search", query == null ? "" : query); }
        });
        session.setActive(true);
        setSessionToken(session.getSessionToken());
        session.setPlaybackState(new PlaybackStateCompat.Builder().setActions(CAR_ACTIONS | PlaybackStateCompat.ACTION_PLAY).build()); // (what a car can ask, before a song)
        // Headphones unplugged or Bluetooth disconnected: pause, like other music apps (a system broadcast: it reaches a
        // receiver that isn't exported too, and no other app can send it to pause the music)
        ContextCompat.registerReceiver(this, unplugged, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    // what a car can ask for: a song from the library it was shown, or one by voice
    private static final long CAR_ACTIONS = PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID | PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH;

    // A song or a search from a car, to the page; NetherFlow not open on the phone (it plays in its page): said on the
    // car's screen, nothing played
    private void fromCar(String action, String text) {
        if (PlaybackPlugin.emit(action, 0, text)) return;
        session.setPlaybackState(new PlaybackStateCompat.Builder().setActions(CAR_ACTIONS)
            .setState(PlaybackStateCompat.STATE_ERROR, 0, 0f)
            .setErrorMessage(PlaybackStateCompat.ERROR_CODE_APP_ERROR, "Open NetherFlow on your phone first: it plays from there")
            .build());
    }

    // The library as a car shows it: liked songs, recently played and the playlists, each song [id, title, artist] — a
    // light copy the page sends when it changes, kept in a file so it's there when a car connects with the app closed.
    private static String library;
    private static final String SHELF = "car-library.json";
    static void setLibrary(Context c, String json) {
        library = json;
        try (FileOutputStream out = new FileOutputStream(new File(c.getFilesDir(), SHELF))) { out.write(json.getBytes(StandardCharsets.UTF_8)); } catch (Exception ignored) {}
        PlaybackService s = instance;
        if (s == null) return;
        for (String id : new String[] { "root", "liked", "recent", "playlists" }) s.notifyChildrenChanged(id);
        try { JSONArray p = new JSONObject(json).optJSONArray("playlists"); for (int i = 0; p != null && i < p.length(); i++) s.notifyChildrenChanged("pl:" + p.getJSONObject(i).optString("id")); } catch (Exception ignored) {}
    }
    private static JSONObject library(Context c) {
        if (library == null) {
            try (FileInputStream in = new FileInputStream(new File(c.getFilesDir(), SHELF)); ByteArrayOutputStream got = new ByteArrayOutputStream()) {
                byte[] b = new byte[65536]; for (int n; (n = in.read(b)) > 0; ) got.write(b, 0, n);
                library = got.toString("UTF-8");
            } catch (Exception e) { library = "{}"; }
        }
        try { return new JSONObject(library); } catch (Exception e) { return new JSONObject(); }
    }

    // Who's shown the library: NetherFlow itself; the system's own media controls (signed as the system is, or holding
    // the permission only system apps get); Android Auto and Google's assistant by their signing certificates — an app
    // can take a package's name where that package isn't installed, never its signature (Android Auto's key was rotated:
    // both of its certificates). Any other app gets the controls, not the list of what you listen to.
    private static final java.util.Map<String, List<String>> SIGNED = new java.util.HashMap<>();
    static {
        SIGNED.put("com.google.android.projection.gearhead", Arrays.asList("1ca8dcc0bed3cbd872d2cb791200c0292ca9975768a82d676b8b424fb65b5295", "fdb00c43dbde8b51cb312aa81d3b5fa17713adb94b28f598d77f8eb89daceedf"));
        SIGNED.put("com.google.android.googlequicksearchbox", Arrays.asList("f0fd6c5b410f25cb25c3b53346c8972fae30f8ee7411df910480ad6b2d60db83"));
    }
    @Override
    public BrowserRoot onGetRoot(@NonNull String client, int uid, Bundle hints) {
        return new BrowserRoot(trusted(client, uid) ? "root" : "none", null);
    }
    boolean trusted(String client, int uid) {
        if (uid == android.os.Process.myUid() || uid == android.os.Process.SYSTEM_UID) return true;
        android.content.pm.PackageManager pm = getPackageManager();
        String[] of = pm.getPackagesForUid(uid); // (the name it gave is its own)
        if (of == null || !Arrays.asList(of).contains(client)) return false;
        if (pm.checkSignatures("android", client) == android.content.pm.PackageManager.SIGNATURE_MATCH) return true; // (the system's own)
        if (pm.checkPermission("android.permission.MEDIA_CONTENT_CONTROL", client) == android.content.pm.PackageManager.PERMISSION_GRANTED) return true; // (system apps only)
        List<String> want = SIGNED.get(client);
        if (want != null) for (String c : certs(pm, client)) if (want.contains(c)) return true;
        return false;
    }
    // a package's signing certificates (and, with a rotated key, the ones before), as SHA-256 hex
    private static List<String> certs(android.content.pm.PackageManager pm, String pkg) {
        List<String> out = new ArrayList<>();
        try {
            android.content.pm.Signature[] sigs;
            if (Build.VERSION.SDK_INT >= 28) {
                android.content.pm.SigningInfo si = pm.getPackageInfo(pkg, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES).signingInfo;
                sigs = si == null ? new android.content.pm.Signature[0] : si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
            } else sigs = pm.getPackageInfo(pkg, android.content.pm.PackageManager.GET_SIGNATURES).signatures;
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            for (android.content.pm.Signature s : sigs) { StringBuilder h = new StringBuilder(); for (byte b : md.digest(s.toByteArray())) h.append(String.format("%02x", b)); out.add(h.toString()); }
        } catch (Exception ignored) {}
        return out;
    }

    @Override
    public void onLoadChildren(@NonNull String parent, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        JSONObject lib = library(this);
        try {
            if (parent.equals("root")) {
                items.add(folder("liked", "Liked songs", lib.optJSONArray("liked")));
                items.add(folder("recent", "Recently played", lib.optJSONArray("recent")));
                JSONArray p = lib.optJSONArray("playlists");
                items.add(folder("playlists", "Playlists", null, (p == null ? 0 : p.length()) + " playlists"));
            } else if (parent.equals("playlists")) {
                JSONArray p = lib.optJSONArray("playlists");
                for (int i = 0; p != null && i < p.length(); i++) { JSONObject x = p.getJSONObject(i); items.add(folder("pl:" + x.optString("id"), x.optString("name"), x.optJSONArray("tracks"))); }
            } else {
                JSONArray songs = songsOf(lib, parent);
                for (int i = 0; songs != null && i < songs.length(); i++) {
                    JSONArray t = songs.getJSONArray(i);
                    // (its id: which list, where in it and which song — the page plays it in that list)
                    String id = new JSONArray().put(parent).put(i).put(t.optString(0)).toString();
                    items.add(new MediaBrowserCompat.MediaItem(new MediaDescriptionCompat.Builder().setMediaId(id).setTitle(t.optString(1)).setSubtitle(t.optString(2)).build(),
                        MediaBrowserCompat.MediaItem.FLAG_PLAYABLE));
                }
            }
        } catch (Exception ignored) {}
        result.sendResult(items);
    }
    private static JSONArray songsOf(JSONObject lib, String parent) throws Exception {
        if (parent.equals("liked") || parent.equals("recent")) return lib.optJSONArray(parent);
        JSONArray p = lib.optJSONArray("playlists");
        for (int i = 0; p != null && i < p.length(); i++) if (("pl:" + p.getJSONObject(i).optString("id")).equals(parent)) return p.getJSONObject(i).optJSONArray("tracks");
        return null;
    }
    private static MediaBrowserCompat.MediaItem folder(String id, String title, JSONArray songs) { return folder(id, title, songs, (songs == null ? 0 : songs.length()) + " songs"); }
    private static MediaBrowserCompat.MediaItem folder(String id, String title, JSONArray songs, String sub) {
        return new MediaBrowserCompat.MediaItem(new MediaDescriptionCompat.Builder().setMediaId(id).setTitle(title).setSubtitle(sub).build(), MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
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
            | (song.getBoolean("hasNext") ? PlaybackStateCompat.ACTION_SKIP_TO_NEXT : 0) | CAR_ACTIONS;
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
        return super.onBind(intent); // (a car, or the phone's media controls, browsing: see onGetRoot)
    }
}
