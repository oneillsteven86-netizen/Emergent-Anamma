import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import { Btn, useToast } from "@/src/components/UI";
import { C, SP, R, F } from "@/src/theme";

export default function Waiver() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [waiver, setWaiver] = useState<{ version: string; text: string } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api("/legal/waiver").then(setWaiver).catch(() => {});
  }, []);

  const accept = async () => {
    if (!waiver) return;
    setLoading(true);
    try {
      await api("/auth/accept-waiver", { method: "POST", body: { version: waiver.version } });
      await refresh();
      router.replace("/(tabs)/home");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + SP.lg }]}>
      <Text style={styles.title}>LIABILITY WAIVER</Text>
      <Text style={styles.sub}>
        {user?.name}, before you train you must read and accept the club waiver (v{waiver?.version || "…"}).
      </Text>
      <ScrollView style={styles.box} contentContainerStyle={{ padding: SP.lg }}>
        <Text style={styles.waiverText}>{waiver?.text || "Loading…"}</Text>
      </ScrollView>
      <Pressable testID="waiver-agree-checkbox" style={styles.checkRow} onPress={() => setAgreed(!agreed)}>
        <Ionicons name={agreed ? "checkbox" : "square-outline"} size={26} color={agreed ? C.brand : C.onSurface3} />
        <Text style={styles.checkText}>I have read, understood and agree to the waiver above.</Text>
      </Pressable>
      <View style={{ paddingBottom: insets.bottom + SP.lg }}>
        <Btn testID="waiver-accept-button" title="ACCEPT & CONTINUE" onPress={accept} disabled={!agreed} loading={loading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface, paddingHorizontal: SP.xl },
  title: { fontFamily: F.display, fontSize: 32, color: C.onSurface, letterSpacing: 1.5 },
  sub: { fontFamily: F.body, fontSize: 14, color: C.onSurface3, marginTop: SP.sm, marginBottom: SP.lg, lineHeight: 20 },
  box: { flex: 1, backgroundColor: C.surface2, borderRadius: R.lg, borderWidth: 1, borderColor: C.border },
  waiverText: { fontFamily: F.body, fontSize: 14, color: C.onSurface2, lineHeight: 22 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: SP.md, paddingVertical: SP.lg },
  checkText: { flex: 1, fontFamily: F.body, fontSize: 13, color: C.onSurface2, lineHeight: 19 },
});
