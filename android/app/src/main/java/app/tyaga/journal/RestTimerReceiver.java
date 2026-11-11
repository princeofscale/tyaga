package app.tyaga.journal;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

/** A single durable timer survives suspension and ordinary process death. */
public class RestTimerReceiver extends BroadcastReceiver {
    static final String FIRE = "app.tyaga.journal.REST_FIRE";
    static final String EXTEND = "app.tyaga.journal.REST_EXTEND";
    static final String CHANNEL = "tyaga-rest-v1";
    static final int NOTICE = 7301;
    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("tyaga-rest-timer", Context.MODE_PRIVATE);
    }
    static boolean permitted(Context context) {
        NotificationChannel channel=Build.VERSION.SDK_INT>=26?((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).getNotificationChannel(CHANNEL):null;
        return (channel==null||channel.getImportance()!=NotificationManager.IMPORTANCE_NONE) && (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && NotificationManagerCompat.from(context).areNotificationsEnabled();
    }
    static boolean exact(Context context) {
        return Build.VERSION.SDK_INT < 31 || ((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
    }
    static void channel(Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Отдых между подходами", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Окончание отдыха и продление на 30 секунд");
            channel.enableVibration(true);
            ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
        }
    }
    static JSONObject timer(Context context) {
        try { return new JSONObject(prefs(context).getString("timer", "{}")); }
        catch (Exception ignored) { return new JSONObject(); }
    }
    static PendingIntent alarm(Context context, long until) {
        Intent intent = new Intent(context, RestTimerReceiver.class).setAction(FIRE).putExtra("until", until);
        return PendingIntent.getBroadcast(context, 7300, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static void schedule(Context context, JSONObject timer) throws Exception {
        long until = timer.getLong("until");
        if (!prefs(context).edit().putString("timer", timer.toString()).remove("action").commit()) throw new Exception("Не удалось сохранить таймер");
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent operation = alarm(context, until);
        try {
            if (exact(context)) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, until, operation);
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, until, operation);
        } catch (Exception error) {
            manager.cancel(operation);
            prefs(context).edit().remove("timer").remove("action").commit();
            throw error;
        }
    }
    static void clear(Context context) {
        ((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).cancel(alarm(context, 0));
        NotificationManagerCompat.from(context).cancel(NOTICE);
        prefs(context).edit().remove("timer").remove("action").apply();
    }
    static void action(Context context, JSONObject timer, String type) throws Exception {
        JSONObject action = new JSONObject(timer.toString());
        action.put("type", type).put("id", java.util.UUID.randomUUID().toString());
        if (!prefs(context).edit().putString("action", action.toString()).commit()) throw new Exception("Не удалось сохранить действие таймера");
    }
    static void show(Context context, JSONObject timer, boolean extended) {
        if (!permitted(context)) return;
        channel(context);
        Intent open = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("tyaga.rest.open", true)
            .putExtra("tyaga.rest.account", timer.optString("accountId"))
            .putExtra("tyaga.rest.workout", timer.optString("workoutId"));
        PendingIntent content = PendingIntent.getActivity(context, 7301, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent extend = new Intent(context, RestTimerReceiver.class).setAction(EXTEND).putExtra("until", timer.optLong("until"));
        PendingIntent more = PendingIntent.getBroadcast(context, 7302, extend, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(extended ? "Отдых продлён на 30 секунд" : "Отдых завершён")
            .setContentText("Вернуться к следующему подходу")
            .setContentIntent(content).setAutoCancel(true).setOnlyAlertOnce(extended)
            .setCategory(NotificationCompat.CATEGORY_ALARM).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, "+30 с", more);
        if (extended) notification.setWhen(timer.optLong("until")).setUsesChronometer(true).setChronometerCountDown(true);
        NotificationManagerCompat.from(context).notify(NOTICE, notification.build());
    }
    @Override public void onReceive(Context context, Intent intent) {
        if (!prefs(context).getBoolean("enabled", false)) return;
        JSONObject timer = timer(context);
        long until = timer.optLong("until", 0);
        if (until == 0 || intent.getLongExtra("until", -1) != until) return;
        try {
            if (EXTEND.equals(intent.getAction())) {
                timer.put("until", Math.max(System.currentTimeMillis(), until) + 30000);
                schedule(context, timer);
                action(context, timer, "extend");
                show(context, timer, true);
            } else if (FIRE.equals(intent.getAction()) && until <= System.currentTimeMillis() + 1000) {
                if (!RestTimerPlugin.foreground || !prefs(context).getBoolean("inWorkout", false)) show(context, timer, false);
            }
        } catch (Exception ignored) {
            // The in-app timer remains available; a receiver must not crash the process.
        }
    }
}
