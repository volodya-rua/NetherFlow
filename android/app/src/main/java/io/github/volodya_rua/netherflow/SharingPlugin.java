// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
package io.github.volodya_rua.netherflow;

import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

// The page's story (a picture, or a video with the song): Sharing.share({ data: base64, name, mime }) opens Android's
// share sheet with it (Instagram stories, WhatsApp…) and, on Android 10 and later, also keeps a copy in the gallery
// (Pictures/NetherFlow or Movies/NetherFlow).
@CapacitorPlugin(name = "Sharing")
public class SharingPlugin extends Plugin {

    @PluginMethod
    public void share(PluginCall call) {
        String data = call.getString("data"), name = call.getString("name", "NetherFlow story.jpg"), mime = call.getString("mime", "image/jpeg");
        if (data == null) { call.reject("nothing to share"); return; }
        boolean video = mime.startsWith("video/");
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            boolean saved = false;
            if (Build.VERSION.SDK_INT >= 29) { // the gallery copy (no permission needed from Android 10)
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/NetherFlow");
                Uri uri = getContext().getContentResolver().insert(video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri != null) try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) { out.write(bytes); saved = true; }
            }
            File dir = new File(getContext().getCacheDir(), "stories");
            dir.mkdirs();
            File file = new File(dir, "story" + name.substring(Math.max(0, name.lastIndexOf('.'))));
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
            Uri shared = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, shared)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, "Share your story"));
            JSObject res = new JSObject();
            res.put("saved", saved);
            call.resolve(res);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
