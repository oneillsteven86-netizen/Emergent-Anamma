import React, { useState } from "react";
import { View, Text, StyleSheet, ImageBackground } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api } from "@/src/api";
import { Btn, Input, useToast } from "@/src/components/UI";
import { C, SP, F, IMAGES } from "@/src/theme";

export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!token) { toast.show("Missing or invalid reset link", "error"); return; }
    if (pw.length < 6) { toast.show("Password must be at least 6 characters", "error"); return; }
    if (pw !== pw2) { toast.show("Passwords don't match", "error"); return; }
    setBusy(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password: pw } });
      toast.show("Password updated. You can sign in now.", "success");
      router.replace("/login");
    } catch (e: any) {
      toast.show(e.message || "Could not reset password", "error");
    } finally { setBusy(false); }
  };

  return (
    <ImageBackground source={{ uri: IMAGES.hero }} style={styles.bg}>
      <LinearGradient
        colors={["rgba(10,10,10,0.6)", "rgba(10,10,10,0.9)", "rgba(10,10,10,0.98)"]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAwareScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + SP.xxxl, paddingBottom: insets.bottom + SP.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoWrap}>
          <Text style={styles.logo}>ANAM</Text>
          <Text style={styles.logoSub}>MMA</Text>
        </View>
        <View style={styles.form}>
          <Text style={styles.title}>SET A NEW PASSWORD</Text>
          <Text style={styles.sub}>
            Choose a new password for your ANAM MMA account.
          </Text>
          <Input label="New password" value={pw} onChangeText={setPw} placeholder="••••••••" secureTextEntry />
          <Input label="Confirm password" value={pw2} onChangeText={setPw2} placeholder="••••••••" secureTextEntry />
          <Btn title="UPDATE PASSWORD" onPress={submit} loading={busy} />
          <Btn title="Back to sign in" variant="ghost" onPress={() => router.replace("/login")} />
        </View>
      </KeyboardAwareScrollView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.surface },
  content: { flexGrow: 1, paddingHorizontal: SP.xl, justifyContent: "space-between" },
  logoWrap: { alignItems: "center", marginTop: SP.xxl },
  logo: { fontFamily: F.display, fontSize: 56, color: C.onSurface, letterSpacing: 8 },
  logoSub: { fontFamily: F.display, fontSize: 24, color: C.brand, letterSpacing: 14, marginTop: -SP.md },
  form: { marginTop: SP.xxl, gap: SP.sm },
  title: { fontFamily: F.display, fontSize: 22, color: C.onSurface, letterSpacing: 3, marginBottom: SP.xs },
  sub: { fontFamily: F.body, fontSize: 13, color: C.onSurface3, marginBottom: SP.lg },
});
