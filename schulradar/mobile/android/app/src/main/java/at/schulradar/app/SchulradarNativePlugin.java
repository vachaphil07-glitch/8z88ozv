package at.schulradar.app;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Native Helfer für die Schulradar-App:
 *  - http: Anfragen mit dem gemeinsamen Android-Cookie-Speicher (wie die Browser-Sitzung am PC)
 *  - web*: Webansichten – unsichtbar (Teams, Letto) oder als Anmeldefenster über der App.
 *          Ein Skript in jedem Frame liest JSON-Antworten mit (wie der Mitschnitt am PC).
 *  - secrets*: Zugangsdaten, verschlüsselt mit dem Android-Keystore
 *  - file*: Daten-Datei im App-Speicher
 */
@CapacitorPlugin(name = "SchulradarNative")
public class SchulradarNativePlugin extends Plugin {

    private static final String KEY_ALIAS = "schulradar_secrets";
    private static final String SECRETS_FILE = "zugangsdaten.bin";
    private static final int MAX_CAPTURED = 300;

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, WebEntry> webs = new ConcurrentHashMap<>();
    private String userAgent = null;

    private static class WebEntry {
        String id;
        WebView view;
        View container;
        boolean hidden;
        volatile boolean capture = false;
        final List<String> captured = Collections.synchronizedList(new ArrayList<>());
        PluginCall pendingLoad;
        Runnable loadTimeout;
        OnBackPressedCallback back;
    }

    // Skript für jeden Frame: fetch/XHR-Antworten mit JSON an die App melden
    private static final String CAPTURE_JS =
        "(function(){if(window.__srCapture)return;window.__srCapture=true;" +
        "function post(u,s,ct,t){try{if(!t||t.length>3000000)return;var c=t.replace(/^\\s+/,'').charAt(0);if(c!=='{'&&c!=='[')return;" +
        "SchulradarCapture.postMessage(JSON.stringify({url:String(u),status:s,mime:ct||'',body:t}));}catch(e){}}" +
        "var of=window.fetch;if(of){window.fetch=function(){var p=of.apply(this,arguments);p.then(function(r){try{" +
        "var ct=(r.headers&&r.headers.get('content-type'))||'';if(/json|text\\/plain/i.test(ct)||/assign|educat|\\/edu\\//i.test(r.url||'')){" +
        "r.clone().text().then(function(t){post(r.url,r.status,ct,t);}).catch(function(){});}}catch(e){}}).catch(function(){});return p;};}" +
        "var XO=XMLHttpRequest.prototype.open,XS=XMLHttpRequest.prototype.send;" +
        "XMLHttpRequest.prototype.open=function(m,u){this.__srUrl=u;return XO.apply(this,arguments);};" +
        "XMLHttpRequest.prototype.send=function(){var x=this;x.addEventListener('load',function(){try{" +
        "var ct=x.getResponseHeader('content-type')||'';var u=x.responseURL||x.__srUrl;" +
        "if((x.responseType===''||x.responseType==='text')&&/json|text\\/plain/i.test(ct)){post(u,x.status,ct,x.responseText);}" +
        "else if(x.responseType==='json'&&x.response){post(u,x.status,ct,JSON.stringify(x.response));}}catch(e){}});" +
        "return XS.apply(this,arguments);};})();";

    // ------------------------------------------------------------------ HTTP

    private String desktopUserAgent() {
        if (userAgent != null) return userAgent;
        String version = "134.0.0.0";
        try {
            String def = WebSettings.getDefaultUserAgent(getContext());
            Matcher m = Pattern.compile("Chrome/([0-9.]+)").matcher(def);
            if (m.find()) version = m.group(1);
        } catch (Exception ignored) {
        }
        userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + version + " Safari/537.36";
        return userAgent;
    }

    @PluginMethod
    public void http(PluginCall call) {
        final String ua = desktopUserAgent();
        pool.execute(() -> {
            try {
                call.resolve(doHttp(call, ua));
            } catch (Exception e) {
                call.reject(e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        });
    }

    private JSObject doHttp(PluginCall call, String ua) throws Exception {
        String url = call.getString("url");
        String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        String body = call.getString("body", null);
        boolean useCookies = call.getBoolean("cookies", true);
        boolean follow = call.getBoolean("followRedirects", true);
        int timeout = call.getInt("timeout", 30000);
        JSObject headers = call.getObject("headers", new JSObject());
        CookieManager cm = CookieManager.getInstance();

        for (int hop = 0; hop < 10; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setRequestMethod(method);
            c.setConnectTimeout(timeout);
            c.setReadTimeout(timeout);
            c.setRequestProperty("User-Agent", ua);
            c.setRequestProperty("Accept-Language", "de-AT,de;q=0.9,en;q=0.7");
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                c.setRequestProperty(k, headers.getString(k));
            }
            if (useCookies) {
                String ck = cm.getCookie(url);
                if (ck != null && !ck.isEmpty()) c.setRequestProperty("Cookie", ck);
            }
            if (body != null && !"GET".equals(method) && !"HEAD".equals(method)) {
                c.setDoOutput(true);
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(bytes.length);
                OutputStream os = c.getOutputStream();
                os.write(bytes);
                os.close();
            }
            int status = c.getResponseCode();
            JSObject outHeaders = new JSObject();
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null || e.getValue() == null || e.getValue().isEmpty()) continue;
                String name = e.getKey().toLowerCase(Locale.ROOT);
                if (name.equals("set-cookie")) {
                    if (useCookies) for (String v : e.getValue()) cm.setCookie(url, v);
                    continue;
                }
                outHeaders.put(name, e.getValue().get(0));
            }
            if (useCookies) cm.flush();
            String location = c.getHeaderField("Location");
            boolean redirect = status >= 300 && status < 400 && location != null;
            if (redirect && follow) {
                String next = resolve(url, location);
                if (next.startsWith("http://") || next.startsWith("https://")) {
                    if (status == 303 || ((status == 301 || status == 302) && "POST".equals(method))) {
                        method = "GET";
                        body = null;
                    }
                    c.disconnect();
                    url = next;
                    continue;
                }
            }
            String text = readBody(c, status);
            c.disconnect();
            JSObject res = new JSObject();
            res.put("status", status);
            res.put("url", url);
            res.put("location", location == null ? null : resolve(url, location));
            res.put("headers", outHeaders);
            res.put("body", text);
            return res;
        }
        throw new Exception("Zu viele Weiterleitungen");
    }

    private static String resolve(String base, String location) {
        if (location.matches("^[a-zA-Z][a-zA-Z0-9+.-]*:.*")) return location;
        try {
            return new URL(new URL(base), location).toString();
        } catch (Exception e) {
            return location;
        }
    }

    private static String readBody(HttpURLConnection c, int status) {
        try {
            InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (is == null) return "";
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            is.close();
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    @PluginMethod
    public void setCookie(PluginCall call) {
        CookieManager cm = CookieManager.getInstance();
        cm.setCookie(call.getString("url"), call.getString("cookie"));
        cm.flush();
        call.resolve();
    }

    @PluginMethod
    public void clearOrigins(PluginCall call) {
        JSArray origins = call.getArray("origins", new JSArray());
        CookieManager cm = CookieManager.getInstance();
        try {
            for (int i = 0; i < origins.length(); i++) {
                String origin = origins.getString(i);
                String cookies = cm.getCookie(origin);
                if (cookies != null) {
                    for (String part : cookies.split(";")) {
                        String name = part.split("=", 2)[0].trim();
                        if (name.isEmpty()) continue;
                        cm.setCookie(origin, name + "=; Max-Age=0; Path=/");
                        cm.setCookie(origin, name + "=; Max-Age=0; Path=/; Secure");
                    }
                }
                WebStorage.getInstance().deleteOrigin(origin);
            }
        } catch (Exception ignored) {
        }
        cm.flush();
        call.resolve();
    }

    @PluginMethod
    public void clearAllData(PluginCall call) {
        main.post(() -> {
            CookieManager.getInstance().removeAllCookies(null);
            CookieManager.getInstance().flush();
            WebStorage.getInstance().deleteAllData();
            new File(getContext().getFilesDir(), SECRETS_FILE).delete();
            call.resolve();
        });
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url")));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // ------------------------------------------------------------------ Webansichten

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics());
    }

    @PluginMethod
    public void webOpen(PluginCall call) {
        final boolean hidden = call.getBoolean("hidden", true);
        final String url = call.getString("url", null);
        final String title = call.getString("title", "Schulradar");
        final String id = UUID.randomUUID().toString();
        main.post(() -> {
            try {
                WebEntry entry = new WebEntry();
                entry.id = id;
                entry.hidden = hidden;
                WebView wv = new WebView(getActivity());
                entry.view = wv;
                configure(wv, entry);
                FrameLayout root = getActivity().findViewById(android.R.id.content);
                if (hidden) {
                    // Desktop-Größe, damit die Seiten wie am PC aussehen; unsichtbar hinter der App
                    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(1280), dp(900));
                    wv.setAlpha(0f);
                    wv.setFocusable(false);
                    wv.setClickable(false);
                    root.addView(wv, 0, lp);
                    entry.container = wv;
                } else {
                    entry.container = buildOverlay(entry, title);
                    root.addView(entry.container, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                    entry.back = new OnBackPressedCallback(true) {
                        @Override
                        public void handleOnBackPressed() {
                            if (entry.view.canGoBack()) entry.view.goBack();
                            else closeEntry(entry);
                        }
                    };
                    getActivity().getOnBackPressedDispatcher().addCallback(entry.back);
                }
                webs.put(id, entry);
                if (url != null) wv.loadUrl(url);
                JSObject res = new JSObject();
                res.put("id", id);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    private View buildOverlay(WebEntry entry, String title) {
        LinearLayout box = new LinearLayout(getActivity());
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackgroundColor(Color.WHITE);
        box.setClickable(true);

        LinearLayout bar = new LinearLayout(getActivity());
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#3B5BDB"));
        bar.setPadding(dp(14), dp(6), dp(6), dp(6));

        TextView tv = new TextView(getActivity());
        tv.setText(title);
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        tv.setSingleLine(true);
        bar.addView(tv, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button done = new Button(getActivity());
        done.setText("Fertig");
        done.setAllCaps(false);
        done.setOnClickListener(v -> closeEntry(entry));
        bar.addView(done, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        box.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        box.addView(entry.view, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        // Platz für Statusleiste und Navigationsleiste lassen (die Tastatur berücksichtigt Capacitor schon)
        ViewCompat.setOnApplyWindowInsetsListener(box, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(box);
        return box;
    }

    private void configure(WebView wv, WebEntry entry) {
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUserAgentString(desktopUserAgent());
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);

        wv.setWebChromeClient(new WebChromeClient());
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if (scheme == null) return true;
                scheme = scheme.toLowerCase(Locale.ROOT);
                // Programme starten (msteams:, intent:, moodlemobile: …) wird nicht erlaubt
                return !(scheme.equals("http") || scheme.equals("https") || scheme.equals("about") || scheme.equals("data") || scheme.equals("blob"));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                navigated(entry, url);
                finishLoad(entry);
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                navigated(entry, url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) finishLoad(entry);
            }
        });

        Set<String> all = new HashSet<>();
        all.add("*");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(wv, "SchulradarCapture", all, (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (!entry.capture) return;
                String data = message.getData();
                if (data == null || data.length() > 3_000_000) return;
                if (entry.captured.size() < MAX_CAPTURED) entry.captured.add(data);
            });
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(wv, CAPTURE_JS, all);
        }
    }

    private void navigated(WebEntry entry, String url) {
        JSObject ev = new JSObject();
        ev.put("id", entry.id);
        ev.put("url", url);
        notifyListeners("webNavigate", ev);
    }

    private void finishLoad(WebEntry entry) {
        PluginCall pending = entry.pendingLoad;
        if (pending == null) return;
        entry.pendingLoad = null;
        if (entry.loadTimeout != null) main.removeCallbacks(entry.loadTimeout);
        JSObject res = new JSObject();
        res.put("url", entry.view.getUrl());
        pending.resolve(res);
    }

    private WebEntry entryOrReject(PluginCall call) {
        WebEntry e = webs.get(call.getString("id", ""));
        if (e == null) call.reject("Webansicht nicht (mehr) vorhanden");
        return e;
    }

    @PluginMethod
    public void webLoad(PluginCall call) {
        WebEntry entry = entryOrReject(call);
        if (entry == null) return;
        final String url = call.getString("url");
        final int timeout = call.getInt("timeout", 45000);
        main.post(() -> {
            finishLoad(entry);
            entry.pendingLoad = call;
            entry.loadTimeout = () -> finishLoad(entry);
            main.postDelayed(entry.loadTimeout, timeout);
            entry.view.loadUrl(url);
        });
    }

    @PluginMethod
    public void webEval(PluginCall call) {
        WebEntry entry = entryOrReject(call);
        if (entry == null) return;
        final String code = call.getString("code");
        main.post(() -> entry.view.evaluateJavascript(code, value -> {
            JSObject res = new JSObject();
            res.put("result", value);
            call.resolve(res);
        }));
    }

    @PluginMethod
    public void webUrl(PluginCall call) {
        WebEntry entry = entryOrReject(call);
        if (entry == null) return;
        main.post(() -> {
            JSObject res = new JSObject();
            res.put("url", entry.view.getUrl());
            call.resolve(res);
        });
    }

    @PluginMethod
    public void webCapture(PluginCall call) {
        WebEntry entry = entryOrReject(call);
        if (entry == null) return;
        entry.capture = call.getBoolean("enable", true);
        if (!entry.capture) entry.captured.clear();
        call.resolve();
    }

    @PluginMethod
    public void webCaptured(PluginCall call) {
        WebEntry entry = entryOrReject(call);
        if (entry == null) return;
        JSArray items = new JSArray();
        synchronized (entry.captured) {
            for (String s : entry.captured) items.put(s);
            entry.captured.clear();
        }
        JSObject res = new JSObject();
        res.put("items", items);
        call.resolve(res);
    }

    @PluginMethod
    public void webClose(PluginCall call) {
        WebEntry entry = webs.get(call.getString("id", ""));
        if (entry == null) {
            call.resolve();
            return;
        }
        main.post(() -> {
            closeEntry(entry);
            call.resolve();
        });
    }

    private void closeEntry(WebEntry entry) {
        if (webs.remove(entry.id) == null) return;
        finishLoad(entry);
        if (entry.back != null) entry.back.remove();
        ViewGroup parent = (ViewGroup) entry.container.getParent();
        if (parent != null) parent.removeView(entry.container);
        entry.view.stopLoading();
        entry.view.destroy();
        CookieManager.getInstance().flush();
        JSObject ev = new JSObject();
        ev.put("id", entry.id);
        notifyListeners("webClosed", ev);
    }

    // ------------------------------------------------------------------ Dateien

    @PluginMethod
    public void fileRead(PluginCall call) {
        pool.execute(() -> {
            JSObject res = new JSObject();
            File f = new File(getContext().getFilesDir(), safeName(call.getString("name")));
            res.put("text", f.exists() ? readFile(f) : null);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void fileWrite(PluginCall call) {
        final String name = safeName(call.getString("name"));
        final String text = call.getString("text", "");
        pool.execute(() -> {
            try {
                synchronized (SchulradarNativePlugin.this) {
                    writeFileAtomic(new File(getContext().getFilesDir(), name), text.getBytes(StandardCharsets.UTF_8), true);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void fileDelete(PluginCall call) {
        File dir = getContext().getFilesDir();
        String name = safeName(call.getString("name"));
        new File(dir, name).delete();
        new File(dir, name + ".bak").delete();
        call.resolve();
    }

    private static String safeName(String name) {
        return name == null ? "unbenannt" : name.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private static String readFile(File f) {
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    private static void writeFileAtomic(File target, byte[] bytes, boolean backup) throws Exception {
        File tmp = new File(target.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(bytes);
            out.getFD().sync();
        }
        if (backup && target.exists()) {
            File bak = new File(target.getPath() + ".bak");
            bak.delete();
            target.renameTo(bak);
        }
        if (!tmp.renameTo(target)) throw new Exception("Datei konnte nicht gespeichert werden");
    }

    // ------------------------------------------------------------------ Zugangsdaten (Keystore)

    private SecretKey secretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(KEY_ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
            kg.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
    }

    @PluginMethod
    public void secretsRead(PluginCall call) {
        pool.execute(() -> {
            JSObject res = new JSObject();
            try {
                File f = new File(getContext().getFilesDir(), SECRETS_FILE);
                String stored = f.exists() ? readFile(f) : null;
                if (stored != null && stored.contains(":")) {
                    String[] parts = stored.trim().split(":", 2);
                    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                    c.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                    res.put("json", new String(c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
                } else {
                    res.put("json", "{}");
                }
            } catch (Exception e) {
                res.put("json", "{}");
                res.put("error", e.getMessage());
            }
            call.resolve(res);
        });
    }

    @PluginMethod
    public void secretsWrite(PluginCall call) {
        final String json = call.getString("json", "{}");
        pool.execute(() -> {
            try {
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE, secretKey());
                byte[] ct = c.doFinal(json.getBytes(StandardCharsets.UTF_8));
                String out = Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
                synchronized (SchulradarNativePlugin.this) {
                    writeFileAtomic(new File(getContext().getFilesDir(), SECRETS_FILE), out.getBytes(StandardCharsets.UTF_8), false);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        pool.shutdownNow();
        super.handleOnDestroy();
    }
}
