package com.fextesports.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Sistemin bu uygulamaya ait bildirim ayarını açar. Android, bildirim iznini
 * iki kez reddeden kullanıcıya izin penceresini bir daha göstermez; Ayarlar'daki
 * "Bildirimleri aç" düğmesi o durumda buraya gelir (utils/push.js izinIste).
 */
@CapacitorPlugin(name = "BildirimAyarlari")
public class BildirimAyarlariPlugin extends Plugin {

    @PluginMethod
    public void ac(PluginCall call) {
        String paket = getContext().getPackageName();
        Intent niyet;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            niyet = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, paket);
        } else {
            niyet = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + paket));
        }
        niyet.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(niyet);
            call.resolve();
        } catch (Exception e) {
            call.reject("Bildirim ayarı açılamadı", e);
        }
    }
}
