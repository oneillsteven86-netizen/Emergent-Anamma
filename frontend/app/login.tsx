import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ImageBackground, Pressable, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import { Btn, Input, useToast } from "@/src/components/UI";
import { C, SP, R, F, IMAGES } from "@/src/theme";

export default function Login() {
  const { login, register } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [bg, setBg] = useState(IMAGES.hero);

  useEffect(() => {
    api("/settings")
      .then((s) => s?.media?.login_bg && setBg(s.media.login_bg))
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (!email || !password || (mode === "register" && !name)) {
      toast.show("Please fill in all required fields", "error");
      return;
    }
    setLoading(true);
    try {
      const user =
        mode === "login" ? await login(email.trim(), password) : await register(name.trim(), email.trim(), password, phone);
      if (user.role === "member" && !user.waiver_accepted) router.replace("/waiver");
      else if (user.role === "admin") router.replace("/(tabs)/dashboard");
      else if (user.role === "coach") router.replace("/(tabs)/coach");
      else router.replace("/(tabs)/home");
    } catch (e: any) {
      toast.show(e.message || "Something went wrong", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ImageBackground source={{ uri: bg }} style={styles.bg}>
      <LinearGradient
        colors={["rgba(10,10,10,0.55)", "rgba(10,10,10,0.85)", "rgba(10,10,10,0.98)"]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + SP.xxxl, paddingBottom: insets.bottom + SP.xl }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <View style={styles.logoWrap}>
          <Text style={styles.logo}>ANAM</Text>
          <Text style={styles.logoSub}>MMA</Text>
          <Text style={styles.tagline}>DISCIPLINE • RESPECT • HEART</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.toggle}>
            <Pressable
              testID="login-tab"
              style={[styles.toggleBtn, mode === "login" && styles.toggleActive]}
              onPress={() => setMode("login")}
            >
              <Text style={[styles.toggleText, mode === "login" && styles.toggleTextActive]}>SIGN IN</Text>
            </Pressable>
            <Pressable
              testID="register-tab"
              style={[styles.toggleBtn, mode === "register" && styles.toggleActive]}
              onPress={() => setMode("register")}
            >
              <Text style={[styles.toggleText, mode === "register" && styles.toggleTextActive]}>JOIN THE CLUB</Text>
            </Pressable>
          </View>

          {mode === "register" && (
            <Input testID="register-name-input" label="Full name" value={name} onChangeText={setName} placeholder="Conor Walsh" autoCapitalize="words" />
          )}
          <Input
            testID="login-email-input"
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Input
            testID="login-password-input"
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
          />
          {mode === "register" && (
            <Input testID="register-phone-input" label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="+353..." keyboardType="phone-pad" />
          )}
          <Btn
            testID="auth-submit-button"
            title={mode === "login" ? "ENTER THE CLUB" : "REQUEST ACCESS"}
            onPress={submit}
            loading={loading}
          />
          <Pressable testID="legal-link" onPress={() => router.push("/legal")} style={{ marginTop: SP.lg, alignItems: "center" }}>
            <Text style={styles.legal}>Terms of Service & Privacy Policy</Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.surface },
  content: { flexGrow: 1, justifyContent: "space-between", paddingHorizontal: SP.xl },
  logoWrap: { alignItems: "center", marginTop: SP.xxl },
  logo: { fontFamily: F.display, fontSize: 64, color: C.onSurface, letterSpacing: 10 },
  logoSub: { fontFamily: F.display, fontSize: 28, color: C.brand, letterSpacing: 16, marginTop: -SP.md },
  tagline: { fontFamily: F.body, fontSize: 11, color: C.onSurface3, letterSpacing: 2.5, marginTop: SP.lg },
  form: { marginTop: SP.xxl },
  toggle: {
    flexDirection: "row", backgroundColor: "rgba(31,31,31,0.85)", borderRadius: R.md,
    padding: 4, marginBottom: SP.xl, borderWidth: 1, borderColor: C.border,
  },
  toggleBtn: { flex: 1, paddingVertical: 11, alignItems: "center", borderRadius: R.sm },
  toggleActive: { backgroundColor: C.brand },
  toggleText: { fontFamily: F.bodyBold, fontSize: 13, color: C.onSurface3, letterSpacing: 1 },
  toggleTextActive: { color: C.onBrand },
  legal: { color: C.onSurface3, fontFamily: F.body, fontSize: 12, textDecorationLine: "underline" },
});
