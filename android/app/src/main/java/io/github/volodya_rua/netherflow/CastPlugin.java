// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.util.Base64;
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
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
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

    @Override
    protected void handleOnDestroy() {
        for (SSLSocket s : socks.values()) try { s.close(); } catch (IOException ignored) {}
        socks.clear();
        pool.shutdownNow();
    }
}
