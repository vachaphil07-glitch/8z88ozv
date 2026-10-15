package at.schulradar.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * Widget für den Startbildschirm: „Heute fällig“ und „Nächster Test“.
 *
 * Die App legt bei jeder Änderung eine kleine Liste der kommenden Aufgaben und Tests (mit Datum) in
 * den SharedPreferences ab. Was „heute“ ist, rechnet das Widget selbst aus – so stimmt es auch am
 * nächsten Morgen, ohne dass die App geöffnet wurde (Android aktualisiert Widgets etwa alle 30 Minuten).
 */
public class SchulradarWidget extends AppWidgetProvider {

    static final String PREFS = "schulradar_widget";
    static final String KEY = "data";
    private static final int[] ROWS = { R.id.widget_row1, R.id.widget_row2, R.id.widget_row3, R.id.widget_row4 };

    /** von der App aufgerufen (SchulradarNativePlugin.widgetUpdate) */
    static void save(Context context, String json) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putString(KEY, json).apply();
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(context, SchulradarWidget.class));
        for (int id : ids) mgr.updateAppWidget(id, build(context));
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(context));
    }

    private static long startOfDay(long ms, int plusDays) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        c.add(Calendar.DAY_OF_MONTH, plusDays);
        return c.getTimeInMillis();
    }

    private static String time(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        return String.format(Locale.GERMAN, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
    }

    private static String when(long due, boolean allDay, long now) {
        long today = startOfDay(now, 0);
        int days = (int) Math.round((startOfDay(due, 0) - today) / 86400000.0);
        String day;
        if (days == 0) day = "heute";
        else if (days == 1) day = "morgen";
        else if (days == 2) day = "übermorgen";
        else {
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(due);
            String[] wd = { "So", "Mo", "Di", "Mi", "Do", "Fr", "Sa" };
            day = wd[c.get(Calendar.DAY_OF_WEEK) - 1] + " (in " + days + " Tagen)";
        }
        return allDay ? day : day + " " + time(due);
    }

    static RemoteViews build(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_schulradar);
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.widget_root, pi);

        long now = System.currentTimeMillis();
        long tomorrow = startOfDay(now, 1);
        long today = startOfDay(now, 0);
        String json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
        List<String> rows = new ArrayList<>();
        int dueToday = 0;
        int overdue = 0;
        String exam = null;
        String next = null;
        try {
            if (json != null) {
                JSONObject data = new JSONObject(json);
                JSONArray tasks = data.optJSONArray("tasks");
                for (int i = 0; tasks != null && i < tasks.length(); i++) {
                    JSONObject t = tasks.getJSONObject(i);
                    long d = t.optLong("d", 0);
                    boolean allDay = t.optBoolean("a", false);
                    boolean late = allDay ? d < today : d < now;
                    if (late) {
                        overdue++;
                        continue;
                    }
                    if (d < tomorrow) {
                        dueToday++;
                        if (rows.size() < ROWS.length) {
                            String s = t.optString("s", "");
                            rows.add((allDay ? "• " : "• " + time(d) + "  ") + t.optString("t", "") + (s.isEmpty() ? "" : "  ·  " + s));
                        }
                    } else if (next == null) {
                        next = "Als Nächstes: " + t.optString("t", "") + " – " + when(d, allDay, now);
                    }
                }
                JSONArray exams = data.optJSONArray("exams");
                for (int i = 0; exams != null && i < exams.length(); i++) {
                    JSONObject e = exams.getJSONObject(i);
                    long d = e.optLong("d", 0);
                    boolean allDay = e.optBoolean("a", false);
                    if ((allDay ? startOfDay(d, 1) : d) <= now) continue;
                    String s = e.optString("s", "");
                    exam = (s.isEmpty() ? "" : s + ": ") + e.optString("t", "Test") + " – " + when(d, allDay, now);
                    break;
                }
            }
        } catch (Exception ignored) {
        }

        if (json == null) v.setTextViewText(R.id.widget_count, "Schulradar öffnen");
        else if (dueToday == 0) v.setTextViewText(R.id.widget_count, overdue > 0 ? overdue + " überfällig" : "Heute nichts fällig");
        else v.setTextViewText(R.id.widget_count, "Heute " + dueToday + " fällig" + (overdue > 0 ? " · " + overdue + " überfällig" : ""));

        if (rows.isEmpty() && next != null) rows.add(next);
        for (int i = 0; i < ROWS.length; i++) {
            if (i < rows.size()) {
                v.setTextViewText(ROWS[i], rows.get(i));
                v.setViewVisibility(ROWS[i], View.VISIBLE);
            } else {
                v.setViewVisibility(ROWS[i], View.GONE);
            }
        }
        v.setTextViewText(R.id.widget_exam, exam != null ? exam : "Keine Tests in Sicht");
        return v;
    }
}
