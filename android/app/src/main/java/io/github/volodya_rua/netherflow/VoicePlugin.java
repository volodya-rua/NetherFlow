// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

// Voice control (the mic by Search, and Drive mode's): what's said, as words, by the phone's own speech recognizer —
// on the phone itself where it can (Android 12+ with its offline speech: nothing leaves it), else the phone's speech
// service (usually Google's, which may send the sound to it, as any app's voice typing does). Only while the mic button's
// held open: one sentence, then it stops. The microphone asked for the first time it's used.
//  - Voice.available() → { on, device }   (device: recognized on the phone itself)
//  - Voice.listen({ lang?, device? }) → { text, alts } or { text: "", why: nothing heard | no internet | denied | language | busy }
//    ("voice" events meanwhile: { state: listening | level | words | heard, text?, level? })
//  - Voice.stop()
@CapacitorPlugin(name = "Voice", permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "mic") })
public class VoicePlugin extends Plugin {

    private SpeechRecognizer sr;
    private long levelAt;

    private boolean onDevice() { return Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext()); }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject o = new JSObject();
        o.put("on", SpeechRecognizer.isRecognitionAvailable(getContext()) || onDevice());
        o.put("device", onDevice());
        call.resolve(o);
    }

    @PluginMethod
    public void listen(PluginCall call) {
        if (getPermissionState("mic") != PermissionState.GRANTED) { requestPermissionForAlias("mic", call, "micAnswered"); return; }
        start(call);
    }

    @PermissionCallback
    private void micAnswered(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) start(call); else call.reject("no microphone", "denied");
    }

    private void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stopNow();
            boolean device = call.getBoolean("device", true) && onDevice();
            try { sr = device ? SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext()) : SpeechRecognizer.createSpeechRecognizer(getContext()); }
            catch (RuntimeException e) { call.reject("no speech recognizer", "unavailable"); return; }
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
            // (the library's names — its artists, playlists, songs — what's said most likely is one of them: Android 13+)
            com.getcapacitor.JSArray words = call.getArray("words");
            if (Build.VERSION.SDK_INT >= 33 && words != null) {
                ArrayList<String> w = new ArrayList<>();
                for (int k = 0; k < words.length() && w.size() < 500; k++) { String x = words.optString(k, ""); if (!x.isEmpty() && x.length() <= 60) w.add(x); }
                if (!w.isEmpty()) i.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, w);
            }
            String lang = call.getString("lang", "");
            if (lang != null && lang.matches("[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*")) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
            final boolean[] done = { false };
            sr.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle b) { tell("listening", null, -1); }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float db) { long now = System.currentTimeMillis(); if (now - levelAt > 80) { levelAt = now; tell("level", null, Math.max(0, Math.min(1, (db + 2) / 12))); } }
                @Override public void onBufferReceived(byte[] b) {}
                @Override public void onEndOfSpeech() { tell("heard", null, -1); }
                @Override public void onPartialResults(Bundle b) { ArrayList<String> t = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION); if (t != null && !t.isEmpty()) tell("words", t.get(0), -1); }
                @Override public void onEvent(int type, Bundle b) {}
                @Override public void onResults(Bundle b) {
                    if (done[0]) return; done[0] = true;
                    ArrayList<String> t = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    JSObject o = new JSObject(); JSArray alts = new JSArray();
                    if (t != null) for (String s : t) alts.put(s);
                    o.put("text", t != null && !t.isEmpty() ? t.get(0) : ""); o.put("alts", alts); o.put("device", device);
                    call.resolve(o); stopNow();
                }
                @Override public void onError(int e) {
                    if (done[0]) return; done[0] = true;
                    String why = e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "nothing heard"
                        : e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ? "no internet"
                        : e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "denied"
                        : Build.VERSION.SDK_INT >= 31 && (e == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || e == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) ? "language" : "busy";
                    JSObject o = new JSObject(); o.put("text", ""); o.put("why", why); // (an answer, not a failure: nothing said is said so)
                    call.resolve(o); stopNow();
                }
            });
            sr.startListening(i);
        });
    }

    private void tell(String state, String text, double level) {
        JSObject o = new JSObject(); o.put("state", state);
        if (text != null) o.put("text", text);
        if (level >= 0) o.put("level", level);
        notifyListeners("voice", o);
    }

    private void stopNow() { if (sr != null) { try { sr.cancel(); sr.destroy(); } catch (RuntimeException ignored) {} sr = null; } }

    @PluginMethod
    public void stop(PluginCall call) { getActivity().runOnUiThread(() -> { if (sr != null) sr.stopListening(); call.resolve(); }); }

    @Override
    protected void handleOnDestroy() { stopNow(); }
}
