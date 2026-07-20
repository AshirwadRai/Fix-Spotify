# Chaquopy's interpreter is reached by reflection from native code.
-keep class com.chaquo.python.** { *; }

# The @JavascriptInterface bridge is called from JS by name; R8 must not rename it.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
