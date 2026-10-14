package io.github.volodya_rua.netherflow;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

// The app's web view. When the app goes to the background or the screen turns off, Android tells a
// web view it's no longer visible, and the page then suspends the YouTube player, so the song stops.
// This one always reports itself visible, so music keeps playing like in any music app.
public class KeepAliveWebView extends CapacitorWebView {

    public KeepAliveWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(View.VISIBLE);
    }
}
