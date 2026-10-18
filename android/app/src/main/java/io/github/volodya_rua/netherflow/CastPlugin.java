// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.util.Base64;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.ServerSocket;
import java.net.URL;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

// The house's network for casting (cast.js, in the page): a question to the house's devices (mDNS, SSDP) and their
// answers, a Cast device's TLS connection (its own certificate taken: a TV makes its own), and HTTP to a DLNA device (by
// hand: the app's own rules stay closed to plain http) — only ever to addresses in the house, never the internet.
//  - Cast.udp({ group, port, data (base64), ms }) → { answers: [{ from, data (base64) }] }
//  - Cast.tlsOpen({ host, port }) → { id }; then the events "tlsData" { id, data (base64) } and "tlsClose" { id }
//  - Cast.tlsWrite({ id, data (base64) }) · Cast.tlsClose({ id })
//  - Cast.http({ method (GET, POST), url, headers, body }) → { status, text }
// And on a TV (Fire TV, Android TV), this app as a TV the others cast to: see "the receiver", below.
@CapacitorPlugin(name = "Cast")
public class CastPlugin extends Plugin {
    private static final int MAX = 2_000_000; // (a description or an answer: small)
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<Integer, SSLSocket> socks = new ConcurrentHashMap<>();
    private final AtomicInteger next = new AtomicInteger(1);

    static boolean privateHost(String h) {
        return h != null && h.matches("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.|169\\.254\\.)\\d+\\.\\d+(\\.\\d+)?$");
    }

    // the question sent three times (0, 0.6, 1.3 s: a device asleep may miss one), from a port of its own — the answers come
    // straight back to it — and those from the house gathered for ms
    @PluginMethod
    public void udp(PluginCall call) {
        String group = call.getString("group", "");
        int port = call.getInt("port", 0), ms = Math.max(500, Math.min(8000, call.getInt("ms", 2500)));
        if (!(group.equals("224.0.0.251") && port == 5353 || group.equals("239.255.255.250") && port == 1900)) { call.reject("not a question it asks"); return; }
        byte[] q = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        pool.execute(() -> {
            JSArray out = new JSArray();
            try (DatagramSocket s = new DatagramSocket()) {
                InetAddress g = InetAddress.getByName(group);
                long start = System.currentTimeMillis(), end = start + ms;
                long[] at = { 0, 600, 1300 };
                int sent = 0;
                byte[] buf = new byte[9000];
                for (;;) {
                    long now = System.currentTimeMillis();
                    while (sent < at.length && now - start >= at[sent]) { s.send(new DatagramPacket(q, q.length, g, port)); sent++; }
                    if (now >= end) break;
                    s.setSoTimeout((int) Math.max(1, Math.min(end, sent < at.length ? start + at[sent] : end) - now));
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    try { s.receive(p); } catch (SocketTimeoutException e) { continue; }
                    String from = p.getAddress().getHostAddress();
                    if (!privateHost(from) || out.length() >= 200) continue;
                    JSObject a = new JSObject();
                    a.put("from", from);
                    a.put("data", Base64.encodeToString(p.getData(), p.getOffset(), p.getLength(), Base64.NO_WRAP));
                    out.put(a);
                }
            } catch (Exception ignored) {} // (no Wi-Fi: nothing found)
            JSObject r = new JSObject();
            r.put("answers", out);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void tlsOpen(PluginCall call) {
        String host = call.getString("host", "");
        int port = call.getInt("port", 8009);
        if (!privateHost(host)) { call.reject("not a device in the house"); return; }
        pool.execute(() -> {
            SSLSocket s;
            int id;
            try {
                SSLContext c = SSLContext.getInstance("TLS");
                c.init(null, new TrustManager[] { new X509TrustManager() { // (a TV's certificate is its own making: taken, for a device in the house only)
                    public void checkClientTrusted(X509Certificate[] chain, String type) {}
                    public void checkServerTrusted(X509Certificate[] chain, String type) {}
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                } }, null);
                s = (SSLSocket) c.getSocketFactory().createSocket();
                s.connect(new InetSocketAddress(host, port), 8000);
                s.setSoTimeout(8000);
                s.startHandshake();
                s.setSoTimeout(0);
                id = next.getAndIncrement();
                socks.put(id, s);
            } catch (Exception e) { call.reject("the device didn't answer"); return; }
            JSObject r = new JSObject();
            r.put("id", id);
            call.resolve(r);
            byte[] buf = new byte[16384];
            try {
                InputStream in = s.getInputStream();
                for (int n; (n = in.read(buf)) > 0;) {
                    JSObject ev = new JSObject();
                    ev.put("id", id);
                    ev.put("data", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
                    notifyListeners("tlsData", ev);
                }
            } catch (IOException ignored) {}
            socks.remove(id);
            try { s.close(); } catch (IOException ignored) {}
            JSObject ev = new JSObject();
            ev.put("id", id);
            notifyListeners("tlsClose", ev);
        });
    }

    @PluginMethod
    public void tlsWrite(PluginCall call) { // (on the plugins' own thread, one after another: the messages in order)
        SSLSocket s = socks.get(call.getInt("id", 0));
        if (s == null) { call.reject("not open"); return; }
        try { OutputStream o = s.getOutputStream(); o.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT)); o.flush(); call.resolve(); }
        catch (IOException e) { try { s.close(); } catch (IOException ignored) {} call.reject("the device let go"); }
    }

    @PluginMethod
    public void tlsClose(PluginCall call) {
        SSLSocket s = socks.remove(call.getInt("id", 0));
        if (s != null) try { s.close(); } catch (IOException ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void http(PluginCall call) {
        String method = call.getString("method", "GET"), url = call.getString("url", ""), body = call.getString("body", "");
        JSObject headers = call.getObject("headers", new JSObject());
        pool.execute(() -> {
            try {
                URI u = new URI(url);
                if (!"http".equals(u.getScheme()) || !privateHost(u.getHost()) || !("GET".equals(method) || "POST".equals(method))) { call.reject("not a device in the house"); return; }
                int port = u.getPort() > 0 ? u.getPort() : 80;
                String path = (u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath()) + (u.getRawQuery() != null ? "?" + u.getRawQuery() : "");
                byte[] b = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
                StringBuilder h = new StringBuilder(method + " " + path + " HTTP/1.1\r\nHost: " + u.getHost() + ":" + port + "\r\nConnection: close\r\n");
                for (Iterator<String> k = headers.keys(); k.hasNext();) {
                    String n = k.next(), v = headers.getString(n);
                    if (v != null && n.matches("[A-Za-z0-9-]+") && !v.contains("\r") && !v.contains("\n")) h.append(n).append(": ").append(v).append("\r\n");
                }
                if ("POST".equals(method)) h.append("Content-Length: ").append(b.length).append("\r\n");
                h.append("\r\n");
                try (Socket s = new Socket()) {
                    s.connect(new InetSocketAddress(u.getHost(), port), 8000);
                    s.setSoTimeout(8000);
                    OutputStream o = s.getOutputStream();
                    o.write(h.toString().getBytes(StandardCharsets.UTF_8));
                    o.write(b);
                    o.flush();
                    // the answer: its status line, its headers, then its body (by its length, in chunks, or to its end)
                    InputStream in = new BufferedInputStream(s.getInputStream());
                    String[] st = line(in).split(" ");
                    int code = st.length > 1 ? Integer.parseInt(st[1]) : 0, len = -1;
                    boolean chunked = false;
                    for (String l; !(l = line(in)).isEmpty();) {
                        String lo = l.toLowerCase(Locale.ROOT);
                        if (lo.startsWith("content-length:")) len = Integer.parseInt(lo.substring(15).trim());
                        if (lo.startsWith("transfer-encoding:") && lo.contains("chunked")) chunked = true;
                    }
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    if (chunked) for (int n; (n = Integer.parseInt(line(in).split(";")[0].trim(), 16)) > 0;) { copy(in, out, n); line(in); }
                    else copy(in, out, len >= 0 ? len : MAX);
                    JSObject r = new JSObject();
                    r.put("status", code);
                    r.put("text", out.toString("UTF-8"));
                    call.resolve(r);
                }
            } catch (Exception e) { call.reject("the device didn't answer"); }
        });
    }

    private static String line(InputStream in) throws IOException {
        StringBuilder s = new StringBuilder();
        for (int c; (c = in.read()) != -1 && c != '\n';) { if (c != '\r') s.append((char) c); if (s.length() > 8192) throw new IOException("too long"); }
        return s.toString();
    }

    private static void copy(InputStream in, ByteArrayOutputStream out, int n) throws IOException {
        byte[] buf = new byte[8192];
        while (n > 0) {
            int r = in.read(buf, 0, Math.min(buf.length, n));
            if (r < 0) return;
            out.write(buf, 0, r);
            n -= r;
            if (out.size() > MAX) throw new IOException("too big");
        }
    }

    // ---- the receiver: on a TV (Fire TV, Android TV), while the app's open there and Settings › Play from other devices is
    // on, this app is a DLNA media renderer the phones and computers on the Wi-Fi cast to (a TV's own Cast or DLNA aside: a
    // Fire TV has neither for other apps). Found by SSDP (answered from the house only), its description, AVTransport and
    // RenderingControl over SOAP. Its commands go to the page (the event "receiver" { action, uri, meta, t, volume, from,
    // who }); the page keeps its state here (receiverState), for the questions asked a second apart. DLNA has no sign-in:
    // anyone on the Wi-Fi can send it a song (a café's, a hotel's too), so the page always shows who's playing, and what it
    // plays is fetched by castInMedia only: https, public addresses, sound or video.
    //  - Cast.receiverStart({ listen }) → { tv, on, name } (listening only on a TV, and only if listen) · Cast.receiverStop()
    //  - Cast.receiverState({ state (PLAYING, PAUSED_PLAYBACK, STOPPED, TRANSITIONING), t, dur, volume })
    private ServerSocket rHttp;
    private MulticastSocket rSsdp;
    private WifiManager.MulticastLock rLock;
    private volatile String rState = "NO_MEDIA_PRESENT", rUri = "", rName = "", rUuid = "";
    private volatile double rT, rDur, rVol = 1;
    private static final String AV = "urn:schemas-upnp-org:service:AVTransport:1", RC = "urn:schemas-upnp-org:service:RenderingControl:1",
        MR = "urn:schemas-upnp-org:device:MediaRenderer:1";

    private boolean isTv() {
        PackageManager pm = getContext().getPackageManager();
        UiModeManager ui = (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
        return ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION || pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
            || pm.hasSystemFeature("amazon.hardware.fire_tv");
    }

    @PluginMethod
    public void receiverStart(PluginCall call) {
        // (a test build only: on a phone too, with force — never NetherFlow's own APKs, which aren't debuggable)
        boolean tv = isTv() || (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0 && call.getBoolean("force", false);
        JSObject r = new JSObject();
        r.put("tv", tv);
        if (tv && call.getBoolean("listen", true) && rHttp == null) {
            try {
                // its name: the kind of TV, never its owner's ("Volodya's Fire TV")
                rName = "NetherFlow on " + (getContext().getPackageManager().hasSystemFeature("amazon.hardware.fire_tv") ? "Fire TV" : Build.MODEL);
                android.content.SharedPreferences p = getContext().getSharedPreferences("cast", Context.MODE_PRIVATE);
                rUuid = p.getString("uuid", "");
                if (rUuid.isEmpty()) { rUuid = java.util.UUID.randomUUID().toString(); p.edit().putString("uuid", rUuid).apply(); }
                WifiManager w = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (w != null) { rLock = w.createMulticastLock("NetherFlow"); rLock.setReferenceCounted(false); rLock.acquire(); } // (or the Wi-Fi drops the searches)
                rHttp = new ServerSocket(0);
                rSsdp = new MulticastSocket(null);
                rSsdp.setReuseAddress(true);
                rSsdp.bind(new InetSocketAddress(1900));
                rSsdp.joinGroup(InetAddress.getByName("239.255.255.250"));
                ServerSocket h = rHttp; MulticastSocket s = rSsdp;
                pool.execute(() -> serveHttp(h));
                pool.execute(() -> serveSsdp(s));
            } catch (Exception e) { stopReceiver(); call.reject("couldn't listen on the Wi-Fi"); return; }
        }
        r.put("on", rHttp != null);
        r.put("name", rName);
        call.resolve(r);
    }

    @PluginMethod
    public void receiverStop(PluginCall call) { stopReceiver(); call.resolve(); }

    @PluginMethod
    public void receiverState(PluginCall call) {
        String st = call.getString("state", "STOPPED");
        if (st.matches("PLAYING|PAUSED_PLAYBACK|STOPPED|TRANSITIONING|NO_MEDIA_PRESENT")) rState = st;
        rT = call.getDouble("t", 0.0); rDur = call.getDouble("dur", 0.0); rVol = call.getDouble("volume", 1.0);
        call.resolve();
    }

    private void stopReceiver() {
        try { if (rHttp != null) rHttp.close(); } catch (IOException ignored) {}
        if (rSsdp != null) rSsdp.close();
        if (rLock != null && rLock.isHeld()) rLock.release();
        rHttp = null; rSsdp = null; rLock = null;
    }

    private static boolean house(InetAddress a) { return a.isLoopbackAddress() || privateHost(a.getHostAddress()); }

    // a search from the house: answered for what it asks (a media renderer, its services, any), from a port of its own,
    // with the address the asker reached it on
    private void serveSsdp(MulticastSocket s) {
        byte[] buf = new byte[4096];
        List<String> ours = Arrays.asList(MR, AV, RC, "upnp:rootdevice");
        while (!s.isClosed()) {
            try {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                s.receive(p);
                String m = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                if (!m.startsWith("M-SEARCH") || !house(p.getAddress())) continue;
                Matcher st = Pattern.compile("(?im)^ST:\\s*(\\S+)").matcher(m);
                if (!st.find()) continue;
                String want = st.group(1);
                List<String> answer = new ArrayList<>();
                if ("ssdp:all".equals(want)) answer.addAll(ours); else if (ours.contains(want) || want.equals("uuid:" + rUuid)) answer.add(want);
                for (String a : answer) try (DatagramSocket d = new DatagramSocket()) {
                    d.connect(p.getAddress(), p.getPort());
                    String msg = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nEXT:\r\nLOCATION: http://" + d.getLocalAddress().getHostAddress() + ":" + rHttp.getLocalPort()
                        + "/desc.xml\r\nSERVER: Android UPnP/1.0 NetherFlow/1\r\nST: " + a + "\r\nUSN: uuid:" + rUuid + (a.startsWith("uuid:") ? "" : "::" + a) + "\r\n\r\n";
                    byte[] b = msg.getBytes(StandardCharsets.UTF_8);
                    d.send(new DatagramPacket(b, b.length));
                }
            } catch (Exception ignored) {} // (closed: stopped)
        }
    }

    private void serveHttp(ServerSocket server) {
        while (!server.isClosed()) {
            try { Socket c = server.accept(); pool.execute(() -> answer(c)); } catch (IOException ignored) {}
        }
    }

    // one request: its description (GET /desc.xml) or a command (POST /av, /rc); from the house only, small, quick
    private void answer(Socket c) {
        try (Socket s = c) {
            if (!house(s.getInetAddress())) return;
            s.setSoTimeout(5000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            String[] rl = line(in).split(" ");
            int len = 0; String action = "", who = "";
            for (String l; !(l = line(in)).isEmpty();) {
                String lo = l.toLowerCase(Locale.ROOT);
                if (lo.startsWith("content-length:")) len = Integer.parseInt(lo.substring(15).trim());
                if (lo.startsWith("soapaction:")) action = l.substring(11).trim().replace("\"", "");
                if (lo.startsWith("x-netherflow-from:")) who = l.substring(18).trim();
            }
            if (len < 0 || len > 65536) { reply(s, 413, "text/plain", ""); return; }
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            copy(in, body, len);
            String path = rl.length > 1 ? rl[1] : "";
            if (rl[0].equals("GET") && path.equals("/desc.xml")) { reply(s, 200, "text/xml; charset=\"utf-8\"", description()); return; }
            if (!rl[0].equals("POST") || !(path.equals("/av") || path.equals("/rc"))) { reply(s, 404, "text/plain", ""); return; }
            String svc = action.contains("#") ? action.substring(0, action.indexOf('#')) : "", name = action.contains("#") ? action.substring(action.indexOf('#') + 1) : "";
            String inner = command(name, body.toString("UTF-8"), s.getInetAddress().getHostAddress(), who);
            if (inner == null) { reply(s, 500, "text/xml; charset=\"utf-8\"", envelope("<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns=\"urn:schemas-upnp-org:control-1-0\"><errorCode>401</errorCode><errorDescription>Invalid Action</errorDescription></UPnPError></detail></s:Fault>")); return; }
            reply(s, 200, "text/xml; charset=\"utf-8\"", envelope("<u:" + name + "Response xmlns:u=\"" + esc(svc) + "\">" + inner + "</u:" + name + "Response>"));
        } catch (Exception ignored) {}
    }

    // a command: told to the page (what it plays, and when); a question: answered from what the page last said.
    // (Its arguments read by hand — no XML parser, so nothing in them is ever fetched or expanded.)
    private String command(String action, String body, String from, String who) {
        JSObject ev = new JSObject();
        ev.put("action", action); ev.put("from", from); ev.put("who", who.replaceAll("[^\\w .()-]", "").substring(0, Math.min(40, who.replaceAll("[^\\w .()-]", "").length())));
        switch (action) {
            case "SetAVTransportURI": {
                String uri = arg(body, "CurrentURI"), meta = arg(body, "CurrentURIMetaData");
                if (!uri.startsWith("https://") || uri.length() > 4096) return null; // (https only: see castInMedia)
                rUri = uri; rState = "STOPPED"; rT = 0;
                ev.put("uri", uri); ev.put("meta", meta.length() > 16384 ? "" : meta);
                break;
            }
            case "Play": rState = "TRANSITIONING"; break;
            case "Pause": rState = "PAUSED_PLAYBACK"; break;
            case "Stop": rState = "STOPPED"; break;
            case "Seek": { double t = 0; for (String p : arg(body, "Target").split(":")) t = t * 60 + parse(p); ev.put("t", t); rT = t; break; }
            case "SetVolume": { double v = Math.max(0, Math.min(100, parse(arg(body, "DesiredVolume")))) / 100; ev.put("volume", v); rVol = v; break; }
            case "GetVolume": return "<CurrentVolume>" + Math.round(rVol * 100) + "</CurrentVolume>";
            case "GetTransportInfo": return "<CurrentTransportState>" + rState + "</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed>";
            case "GetPositionInfo": return "<Track>1</Track><TrackDuration>" + hms(rDur) + "</TrackDuration><TrackMetaData></TrackMetaData><TrackURI>" + esc(rUri) + "</TrackURI><RelTime>"
                + hms(rT) + "</RelTime><AbsTime>" + hms(rT) + "</AbsTime><RelCount>2147483647</RelCount><AbsCount>2147483647</AbsCount>";
            case "GetMediaInfo": return "<NrTracks>1</NrTracks><MediaDuration>" + hms(rDur) + "</MediaDuration><CurrentURI>" + esc(rUri) + "</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>"
                + "<NextURI></NextURI><NextURIMetaData></NextURIMetaData><PlayMedium>NETWORK</PlayMedium><RecordMedium>NOT_IMPLEMENTED</RecordMedium><WriteStatus>NOT_IMPLEMENTED</WriteStatus>";
            default: return null;
        }
        notifyListeners("receiver", ev, true);
        return "";
    }

    private String description() {
        String svc = "<service><serviceType>%s</serviceType><serviceId>urn:upnp-org:serviceId:%s</serviceId><controlURL>/%s</controlURL><eventSubURL>/%s/ev</eventSubURL><SCPDURL>/%s.xml</SCPDURL></service>";
        return "<?xml version=\"1.0\"?><root xmlns=\"urn:schemas-upnp-org:device-1-0\"><specVersion><major>1</major><minor>0</minor></specVersion><device><deviceType>" + MR + "</deviceType>"
            + "<friendlyName>" + esc(rName) + "</friendlyName><manufacturer>NetherFlow</manufacturer><modelName>NetherFlow</modelName><UDN>uuid:" + rUuid + "</UDN><serviceList>"
            + String.format(svc, AV, "AVTransport", "av", "av", "av") + String.format(svc, RC, "RenderingControl", "rc", "rc", "rc") + "</serviceList></device></root>";
    }

    private static String envelope(String inner) {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>" + inner + "</s:Body></s:Envelope>";
    }

    private static void reply(Socket s, int code, String type, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        String h = "HTTP/1.1 " + code + (code == 200 ? " OK" : " Error") + "\r\nContent-Type: " + type + "\r\nContent-Length: " + b.length + "\r\nConnection: close\r\n\r\n";
        OutputStream o = s.getOutputStream();
        o.write(h.getBytes(StandardCharsets.UTF_8)); o.write(b); o.flush();
    }

    private static String arg(String body, String name) {
        Matcher m = Pattern.compile("<(?:\\w+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?" + name + ">").matcher(body);
        return m.find() ? unesc(m.group(1).trim()) : "";
    }
    private static String esc(String s) { return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;"); }
    private static String unesc(String s) { return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&"); }
    private static double parse(String s) { try { return Double.parseDouble(s.trim()); } catch (Exception e) { return 0; } }
    private static String hms(double t) { long s = Math.max(0, Math.round(Math.floor(t))); return String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60); }

    // What the page plays of a song sent to this TV (/_fs/castin?u=…, MainActivity), as one of its own files: https only,
    // and every address it goes to public — each redirect checked again, by hand — so no one on the Wi-Fi can make the TV
    // fetch this house's own devices or itself; and only sound or video. (A name that turns to another address between
    // the check and the fetch still meets https's own check of its certificate: a house's devices hold none for it.)
    static WebResourceResponse castInMedia(WebResourceRequest request) {
        String u = request.getUrl().getQueryParameter("u"), range = null;
        for (Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) if ("range".equalsIgnoreCase(h.getKey())) range = h.getValue();
        try {
            for (int hop = 0; hop < 6 && u != null; hop++) {
                URL url = new URL(u);
                if (!"https".equals(url.getProtocol())) return refused(403);
                for (InetAddress a : InetAddress.getAllByName(url.getHost())) if (!publicAddress(a)) return refused(403);
                HttpsURLConnection c = (HttpsURLConnection) url.openConnection();
                c.setInstanceFollowRedirects(false); c.setConnectTimeout(8000); c.setReadTimeout(20000);
                if (range != null) c.setRequestProperty("Range", range);
                int code = c.getResponseCode();
                if (code >= 300 && code < 400) { String to = c.getHeaderField("Location"); c.disconnect(); u = to == null ? null : new URL(url, to).toString(); continue; }
                String type = c.getContentType() == null ? "" : c.getContentType().split(";")[0].trim().toLowerCase(Locale.ROOT);
                if (code != 200 && code != 206) { c.disconnect(); return refused(502); }
                if (!(type.startsWith("audio/") || type.startsWith("video/") || type.equals("application/ogg"))) { c.disconnect(); return refused(415); }
                Map<String, String> head = new java.util.HashMap<>();
                head.put("Accept-Ranges", "bytes"); head.put("Cache-Control", "no-store");
                for (String k : new String[] { "Content-Length", "Content-Range" }) if (c.getHeaderField(k) != null) head.put(k, c.getHeaderField(k));
                return new WebResourceResponse(type, null, code, code == 206 ? "Partial Content" : "OK", head, code == 206 ? skipped(c.getInputStream(), range) : c.getInputStream());
            }
            return refused(502);
        } catch (Exception e) { return refused(502); }
    }

    // Android's web view goes to the range asked for itself, skipping in what it's given: given the range already (its
    // source's 206), that skip is answered without reading, or it would skip twice
    static InputStream skipped(InputStream in, String range) {
        Matcher m = Pattern.compile("bytes=(\\d+)-").matcher(range == null ? "" : range);
        long start = m.find() ? Long.parseLong(m.group(1)) : 0;
        return new java.io.FilterInputStream(in) {
            long ahead = start;
            @Override public long skip(long n) throws IOException { if (ahead > 0) { long k = Math.min(n, ahead); ahead -= k; return k; } return super.skip(n); }
        };
    }

    static boolean publicAddress(InetAddress a) {
        if (a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress() || a.isSiteLocalAddress() || a.isMulticastAddress()) return false;
        byte[] b = a.getAddress();
        if (b.length == 4) { int x = b[0] & 255, y = b[1] & 255; return x != 0 && x < 224 && !(x == 100 && (y & 0xc0) == 64) && !(x == 192 && y == 0 && (b[2] & 255) == 0) && !(x == 198 && (y & 0xfe) == 18); } // (0/8, 100.64/10, 192.0.0/24, 198.18/15, 224+)
        return (b[0] & 0xfe) != 0xfc; // (IPv6: not fc00::/7, the house's own)
    }

    private static WebResourceResponse refused(int code) {
        return new WebResourceResponse("text/plain", "utf-8", code, "Refused", null, new java.io.ByteArrayInputStream(new byte[0]));
    }

    @Override
    protected void handleOnDestroy() {
        stopReceiver();
        for (SSLSocket s : socks.values()) try { s.close(); } catch (IOException ignored) {}
        socks.clear();
        pool.shutdownNow();
    }
}
