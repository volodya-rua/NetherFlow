// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.widget.RemoteViews;

// The home-screen widget: what's playing — its cover, its title, its artist (or, with lyrics on the lock screen, the
// line being sung) — and previous / play-pause / next. PlaybackService keeps it up to date while NetherFlow plays; with
// NetherFlow closed, a tap on it opens the app.
public class NowPlayingWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        refresh(c, PlaybackService.instance);
    }

    static void refresh(Context c, PlaybackService s) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_now_playing);
        PendingIntent open = PendingIntent.getActivity(c, 10, new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        v.setOnClickPendingIntent(R.id.w_root, open);
        if (s == null) {
            v.setTextViewText(R.id.w_title, "NetherFlow");
            v.setTextViewText(R.id.w_sub, "Tap to open");
            v.setImageViewResource(R.id.w_art, R.drawable.ic_stat_netherflow);
            v.setImageViewResource(R.id.w_toggle, R.drawable.ic_nf_play);
            for (int id : new int[] { R.id.w_prev, R.id.w_toggle, R.id.w_next }) v.setOnClickPendingIntent(id, open);
        } else {
            v.setTextViewText(R.id.w_title, s.title());
            v.setTextViewText(R.id.w_sub, s.subtitle());
            Bitmap art = s.widgetArt();
            if (art != null) v.setImageViewBitmap(R.id.w_art, art); else v.setImageViewResource(R.id.w_art, R.drawable.ic_stat_netherflow);
            v.setImageViewResource(R.id.w_toggle, s.isPlaying() ? R.drawable.ic_nf_pause : R.drawable.ic_nf_play);
            v.setOnClickPendingIntent(R.id.w_prev, s.press("nf.prev", 1));
            v.setOnClickPendingIntent(R.id.w_toggle, s.press("nf.toggle", 2));
            v.setOnClickPendingIntent(R.id.w_next, s.press("nf.next", 3));
        }
        AppWidgetManager.getInstance(c).updateAppWidget(new ComponentName(c, NowPlayingWidget.class), v);
    }
}
