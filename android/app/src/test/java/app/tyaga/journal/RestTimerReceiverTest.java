package app.tyaga.journal;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=35)
public class RestTimerReceiverTest {
    private Context context;
    private AlarmManager alarms;
    private NotificationManager notifications;
    @Before public void prepare() {
        context=RuntimeEnvironment.getApplication();
        alarms=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
        notifications=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
        Shadows.shadowOf(alarms).setCanScheduleExactAlarms(true);
        RestTimerReceiver.prefs(context).edit().clear().putBoolean("enabled",true).commit();
        RestTimerPlugin.foreground=false;
    }
    private JSONObject timer(long until) throws Exception {
        return new JSONObject().put("accountId","owner").put("workoutId","workout").put("until",until).put("exerciseId","bench").put("setId","next-set");
    }
    @Test public void deadlineIsDurableAndCancellationRemovesAlarmAndAction() throws Exception {
        JSONObject timer=timer(System.currentTimeMillis()+60000);
        RestTimerReceiver.schedule(context,timer);
        assertEquals(timer.getLong("until"),RestTimerReceiver.timer(context).getLong("until"));
        assertEquals(1,Shadows.shadowOf(alarms).getScheduledAlarms().size());
        RestTimerReceiver.action(context,timer,"open");
        RestTimerReceiver.clear(context);
        assertTrue(Shadows.shadowOf(alarms).getScheduledAlarms().isEmpty());
        assertFalse(RestTimerReceiver.prefs(context).contains("timer"));
        assertFalse(RestTimerReceiver.prefs(context).contains("action"));
    }
    @Test public void backgroundCompletionNotifiesAndExtendKeepsTheNextSetWhileOldAlarmIsIgnored() throws Exception {
        long until=System.currentTimeMillis()-1000;
        RestTimerReceiver.schedule(context,timer(until));
        RestTimerReceiver receiver=new RestTimerReceiver();
        receiver.onReceive(context,new Intent(RestTimerReceiver.FIRE).putExtra("until",until));
        Notification done=Shadows.shadowOf(notifications).getNotification(RestTimerReceiver.NOTICE);
        assertNotNull(done);
        assertEquals("Отдых завершён",done.extras.getCharSequence(Notification.EXTRA_TITLE));
        assertEquals("+30 с",done.actions[0].title);
        assertEquals(MainActivity.class.getName(),Shadows.shadowOf(done.contentIntent).getSavedIntent().getComponent().getClassName());
        receiver.onReceive(context,new Intent(RestTimerReceiver.EXTEND).putExtra("until",until));
        JSONObject extended=RestTimerReceiver.timer(context);
        assertTrue(extended.getLong("until")>=System.currentTimeMillis()+29000);
        assertEquals("next-set",extended.getString("setId"));
        JSONObject action=new JSONObject(RestTimerReceiver.prefs(context).getString("action","{}"));
        assertEquals("extend",action.getString("type"));
        receiver.onReceive(context,new Intent(RestTimerReceiver.FIRE).putExtra("until",until));
        assertEquals("Отдых продлён на 30 секунд",Shadows.shadowOf(notifications).getNotification(RestTimerReceiver.NOTICE).extras.getCharSequence(Notification.EXTRA_TITLE));
    }
    @Test public void disabledOrForegroundTimerDoesNotDuplicateTheInAppAlert() throws Exception {
        long until=System.currentTimeMillis()-1000;
        RestTimerReceiver.schedule(context,timer(until));
        RestTimerReceiver.prefs(context).edit().putBoolean("enabled",false).commit();
        new RestTimerReceiver().onReceive(context,new Intent(RestTimerReceiver.FIRE).putExtra("until",until));
        assertNull(Shadows.shadowOf(notifications).getNotification(RestTimerReceiver.NOTICE));
        RestTimerReceiver.prefs(context).edit().putBoolean("enabled",true).putBoolean("inWorkout",true).commit();
        RestTimerPlugin.foreground=true;
        new RestTimerReceiver().onReceive(context,new Intent(RestTimerReceiver.FIRE).putExtra("until",until));
        assertNull(Shadows.shadowOf(notifications).getNotification(RestTimerReceiver.NOTICE));
    }
}
