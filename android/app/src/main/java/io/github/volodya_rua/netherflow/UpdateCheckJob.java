// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

// Update notifications (Settings › Update notifications, on unless turned off): about once a day, with any connection
// and even with NetherFlow closed, Android runs this — the latest release's update.json read from GitHub (the very file
// Settings › Update reads), and a newer NetherFlow than the one in use, not told of yet, said in a notification; tapped,
// NetherFlow opens on Settings › Update (MainActivity's extra "nfOpen"). Only NetherFlow's own APK: an app store's is
// updated (and announced) by that store. The page schedules it (UpdatePlugin.notifications) each time the app opens, so
// a phone restarted, which drops it, has it again at the next open — no permission to start with the phone is asked for.
public class UpdateCheckJob extends JobService {
    static final int ID = 5317;
    private static final String CHANNEL = "updates", LATEST = "https://github.com/volodya-rua/NetherFlow/releases/latest/download/update.json";
    private Thread work;

    static void schedule(Context c, boolean on) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        if (!on) { js.cancel(ID); return; }
        if (js.getPendingJob(ID) != null) return; // (already set: its day not started again)
        js.schedule(new JobInfo.Builder(ID, new ComponentName(c, UpdateCheckJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(24 * 3600_000L).build());
    }

    @Override public boolean onStartJob(JobParameters p) {
        work = new Thread(() -> { try { check(getApplicationContext()); } catch (Exception ignored) {} jobFinished(p, false); });
        work.start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters p) { if (work != null) work.interrupt(); return true; }

    // the check itself: a newer version than the one in use, not told of yet → the notification
    static void check(Context c) throws Exception {
        if (!UpdatePlugin.ours(c)) return;
        HttpURLConnection h = (HttpURLConnection) new URL(LATEST).openConnection();
        h.setConnectTimeout(15000); h.setReadTimeout(20000);
        String body;
        try (InputStream in = h.getInputStream()) {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] b = new byte[16384];
            for (int k; (k = in.read(b)) > 0 && o.size() < 1_000_000; ) o.write(b, 0, k); // (it's a few KB; never more than a MB read)
            body = new String(o.toByteArray(), StandardCharsets.UTF_8);
        } finally { h.disconnect(); }
        String v = new JSONObject(body).optString("version", "");
        SharedPreferences prefs = c.getSharedPreferences("nfUpdate", Context.MODE_PRIVATE);
        if (!v.matches("\\d+(\\.\\d+){1,3}") || !newer(v, UpdatePlugin.webVersion(c)) || v.equals(prefs.getString("told", ""))) return;
        prefs.edit().putString("told", v).apply();
        notify(c, v);
    }

    static void notify(Context c, String version) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(c, MainActivity.class).putExtra("nfOpen", "update").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        nm.notify(ID, new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_netherflow)
            .setContentTitle("NetherFlow " + version + " is out")
            .setContentText("Tap to see what's new and update")
            .setContentIntent(PendingIntent.getActivity(c, ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .setAutoCancel(true)
            .build());
    }

    // a version newer than another ("1.10.0" over "1.9.3")
    static boolean newer(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < 4; i++) {
            int p = i < x.length ? Integer.parseInt(x[i]) : 0, q = i < y.length && y[i].matches("\\d+") ? Integer.parseInt(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }
}
