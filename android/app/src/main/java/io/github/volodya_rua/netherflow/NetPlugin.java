// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.content.Context;
import android.net.ConnectivityManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

// The phone's own address on the Wi-Fi, for phone ↔ PC sync: the page looks for the computer on the same network (a web
// page can't learn its address itself); and whether the connection's free (Wi-Fi, a cable — not mobile data), for saving
// liked songs by themselves (the page can't tell: Android's web view says "unknown").
//  - Net.wifi() → { ip: "192.168.1.23" ("" when not on a local network), free: true }
@CapacitorPlugin(name = "Net")
public class NetPlugin extends Plugin {
    @PluginMethod
    public void wifi(PluginCall call) {
        String ip = "";
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                String name = ni.getName();
                if (!ni.isUp() || ni.isLoopback() || !(name.startsWith("wlan") || name.startsWith("eth") || name.startsWith("ap"))) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) if (a instanceof Inet4Address) { ip = a.getHostAddress(); break; }
                if (!ip.isEmpty()) break;
            }
        } catch (Exception ignored) {}
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        JSObject r = new JSObject();
        r.put("ip", ip);
        r.put("free", cm != null && cm.getActiveNetwork() != null && !cm.isActiveNetworkMetered());
        call.resolve(r);
    }
}
