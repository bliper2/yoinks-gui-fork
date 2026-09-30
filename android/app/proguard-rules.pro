# R8 rules for Yoinks.

# youtubedl-android maps yt-dlp's JSON with Jackson (reflection) and loads
# its runtime (Python, ffmpeg, yt-dlp) by class/file name: keep it whole.
-keep class com.yausername.** { *; }
-keep class com.fasterxml.jackson.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-dontwarn com.fasterxml.jackson.databind.ext.**
-dontwarn java.beans.**
-dontwarn org.w3c.dom.bootstrap.**
-dontwarn org.apache.commons.compress.**

# kotlinx.serialization: keep generated serializers of our @Serializable models.
-keepclassmembers @kotlinx.serialization.Serializable class com.yoinks.app.** {
    static ** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class com.yoinks.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.yoinks.app.**$$serializer { *; }

# OkHttp optional platform integrations.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
