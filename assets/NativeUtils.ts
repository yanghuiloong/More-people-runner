
import { sys, native } from 'cc';

export class NativeUtils {
    public static vibrate(ms: number) {
        if (!sys.isNative) {
            // Web / WeChat / Preview
            if (navigator && navigator.vibrate) {
                try {
                    navigator.vibrate(ms);
                } catch (e) {
                    console.warn("Navigator vibrate failed:", e);
                }
            }
        } else if (sys.os === sys.OS.ANDROID) {
            // Android Native (JNI)
            try {
                // Call CocosHelper.vibrate(float seconds)
                // Signature: (F)V means takes a float and returns void
                native.reflection.callStaticMethod("com/cocos/lib/CocosHelper", "vibrate", "(F)V", ms / 1000);
            } catch (e) {
                console.error("JNI Vibrate Failed:", e);
            }
        }
        // iOS vibration is complicated (Taptic Engine), often handled by other plugins.
        // For now, we leave it empty or rely on engine fallback if any.
    }
}
