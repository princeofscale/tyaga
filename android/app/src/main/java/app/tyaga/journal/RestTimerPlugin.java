package app.tyaga.journal;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

@CapacitorPlugin(name="RestTimer", permissions={@Permission(alias="notifications", strings={Manifest.permission.POST_NOTIFICATIONS})})
public class RestTimerPlugin extends Plugin {
    static volatile boolean foreground = false;
    @Override protected void handleOnResume() {foreground=true;notifyListeners("action",new JSObject());}
    @Override protected void handleOnPause() {foreground=false;}
    private void captureOpen(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("tyaga.rest.open", false)) return;
        JSONObject timer = RestTimerReceiver.timer(getContext());
        if (timer.optString("accountId").equals(intent.getStringExtra("tyaga.rest.account"))
            && timer.optString("workoutId").equals(intent.getStringExtra("tyaga.rest.workout"))) {
            try { RestTimerReceiver.action(getContext(), timer, "open"); }
            catch (Exception ignored) { }
        }
        intent.removeExtra("tyaga.rest.open");
    }
    @Override protected void handleOnNewIntent(Intent intent) {
        captureOpen(intent);
        notifyListeners("action", new JSObject());
    }
    private JSObject state() {
        RestTimerReceiver.channel(getContext());
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("enabled", RestTimerReceiver.prefs(getContext()).getBoolean("enabled", false));
        result.put("permission", RestTimerReceiver.permitted(getContext()));
        result.put("exact", RestTimerReceiver.exact(getContext()));
        try { result.put("action", new JSONObject(RestTimerReceiver.prefs(getContext()).getString("action", "null"))); }
        catch (Exception ignored) { result.put("action", JSONObject.NULL); }
        return result;
    }
    @PluginMethod public void getState(PluginCall call) {
        captureOpen(getActivity().getIntent());
        call.resolve(state());
    }
    @PluginMethod public void enable(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermission");
        } else enableAfterPermission(call);
    }
    @PermissionCallback private void notificationPermission(PluginCall call) { enableAfterPermission(call); }
    private void enableAfterPermission(PluginCall call) {
        RestTimerReceiver.channel(getContext());
        RestTimerReceiver.prefs(getContext()).edit().putBoolean("enabled", RestTimerReceiver.permitted(getContext())).apply();
        call.resolve(state());
    }
    @PluginMethod public void disable(PluginCall call) {
        RestTimerReceiver.prefs(getContext()).edit().putBoolean("enabled", false).apply();
        RestTimerReceiver.clear(getContext());
        call.resolve(state());
    }
    @PluginMethod public void openSettings(PluginCall call) {
        String kind = call.getString("kind", "notifications");
        Intent intent = Build.VERSION.SDK_INT >= 31 && "exact".equals(kind)
            ? new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()))
            : new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        getActivity().startActivity(intent);
        call.resolve();
    }
    @PluginMethod public void sync(PluginCall call) {
        String accountId = call.getString("accountId", ""), workoutId = call.getString("workoutId", "");
        Long until = call.getLong("until");
        RestTimerReceiver.prefs(getContext()).edit().putBoolean("inWorkout",call.getBoolean("inWorkout",false)).apply();
        JSONObject current = RestTimerReceiver.timer(getContext());
        if (accountId.isEmpty() || accountId.length()>100 || workoutId.length()>100) {call.reject("Проверь владельца таймера");return;}
        if (until == null || until <= System.currentTimeMillis() || workoutId.isEmpty()) {
            if (accountId.equals(current.optString("accountId")) && (workoutId.isEmpty() || workoutId.equals(current.optString("workoutId")))) RestTimerReceiver.clear(getContext());
            call.resolve();return;
        }
        if (until > System.currentTimeMillis()+7200000) {call.reject("Отдых не может быть дольше двух часов");return;}
        if (!RestTimerReceiver.prefs(getContext()).getBoolean("enabled", false) || !RestTimerReceiver.permitted(getContext())) {call.resolve();return;}
        try {
            String exerciseId=call.getString("exerciseId", ""),setId=call.getString("setId", "");
            if (until == current.optLong("until") && accountId.equals(current.optString("accountId")) && workoutId.equals(current.optString("workoutId")) && exerciseId.equals(current.optString("exerciseId")) && setId.equals(current.optString("setId"))) {call.resolve();return;}
            JSONObject timer = new JSONObject().put("accountId", accountId).put("workoutId", workoutId).put("until", until).put("exerciseId", exerciseId).put("setId", setId);
            RestTimerReceiver.schedule(getContext(), timer);
            androidx.core.app.NotificationManagerCompat.from(getContext()).cancel(RestTimerReceiver.NOTICE);
            call.resolve();
        } catch (Exception e) {call.reject("Не удалось запланировать уведомление отдыха", e);}
    }
    @PluginMethod public void acknowledge(PluginCall call) {
        try {
            JSONObject action = new JSONObject(RestTimerReceiver.prefs(getContext()).getString("action", "{}"));
            if (action.optString("id").equals(call.getString("id", ""))) RestTimerReceiver.prefs(getContext()).edit().remove("action").apply();
        } catch (Exception ignored) { }
        call.resolve();
    }
}
