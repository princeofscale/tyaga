package app.tyaga.journal;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Opens Android's installer for an APK the app downloaded into its cache
 * (src/device/appUpdate.ts). The person confirms the update there; Android asks
 * once to allow installs from Тяга.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        File apk = path == null ? null : new File(path.startsWith("file://") ? Uri.parse(path).getPath() : path);
        if (apk == null || !apk.isFile()) {
            call.reject("Файл обновления не найден");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Не удалось открыть установщик", e);
        }
    }
}
