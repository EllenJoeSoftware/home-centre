# kotlinx.serialization models
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class com.ellenjoe.homecentre.core.model.**$$serializer { *; }
-keepclassmembers class com.ellenjoe.homecentre.core.model.** { *** Companion; }
-keepclasseswithmembers class com.ellenjoe.homecentre.core.model.** { kotlinx.serialization.KSerializer serializer(...); }
