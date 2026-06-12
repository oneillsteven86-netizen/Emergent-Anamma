import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Modal, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { C, SP, R, F } from "@/src/theme";

export function Btn({ title, onPress, variant = "primary", disabled, loading, small, testID, style }: any) {
  const bg = variant === "primary" ? C.brand : variant === "danger" ? "#3a1414" : C.surface3;
  const color = variant === "primary" ? C.onBrand : variant === "danger" ? C.error : C.onSurface;
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress && onPress();
      }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        small && { paddingVertical: 8, paddingHorizontal: SP.md, minHeight: 36 },
        variant === "outline" && { backgroundColor: "transparent", borderWidth: 1, borderColor: C.borderStrong },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <Text style={[styles.btnText, { color }, small && { fontSize: 13 }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input({ label, testID, style, ...props }: any) {
  return (
    <View style={{ marginBottom: SP.md }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        testID={testID}
        placeholderTextColor={C.onSurface3}
        style={[styles.input, style]}
        {...props}
      />
    </View>
  );
}

export function Card({ children, style, testID }: any) {
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children, right }: any) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Chip({ label, active, onPress, testID }: any) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: C.brand, borderColor: C.brand }]}
    >
      <Text style={[styles.chipText, active && { color: C.onBrand, fontFamily: F.bodyBold }]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ icon = "calendar-outline", text }: any) {
  return (
    <View style={styles.empty} testID="empty-state">
      <Ionicons name={icon} size={40} color={C.onSurface3} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function Badge({ text, tone = "neutral" }: { text: string; tone?: string }) {
  const map: any = {
    neutral: { bg: C.surface3, fg: C.onSurface3 },
    gold: { bg: C.brandTint, fg: C.onBrandTint },
    success: { bg: "#12290f", fg: "#7ddc72" },
    warning: { bg: "#2e1f04", fg: "#f5b942" },
    error: { bg: "#330d0d", fg: "#ff8a80" },
  };
  const t = map[tone] || map.neutral;
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

export function CapacityBar({ booked, capacity }: { booked: number; capacity: number }) {
  const pct = Math.min(booked / Math.max(capacity, 1), 1);
  return (
    <View style={styles.capRow}>
      <View style={styles.capTrack}>
        <View
          style={[styles.capFill, { width: `${pct * 100}%` as any, backgroundColor: pct >= 1 ? C.error : pct > 0.75 ? C.warning : C.brand }]}
        />
      </View>
      <Text style={styles.capText}>
        {booked}/{capacity}
      </Text>
    </View>
  );
}

// ---------- Bottom Sheet (simple modal-based) ----------
export function Sheet({ visible, onClose, title, children }: any) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} testID="sheet-backdrop" />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
        <ScrollView
          style={{ maxHeight: 560 }}
          contentContainerStyle={{ paddingBottom: SP.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------- Toast ----------
const ToastCtx = createContext<{ show: (msg: string, tone?: "success" | "error") => void }>({ show: () => {} });

export function ToastProvider({ children }: any) {
  const [toast, setToast] = useState<{ msg: string; tone: string } | null>(null);
  const timer = useRef<any>(null);
  const show = useCallback((msg: string, tone: "success" | "error" = "success") => {
    Haptics.notificationAsync(
      tone === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
    ).catch(() => {});
    setToast({ msg, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      {toast && (
        <View style={[styles.toast, { borderColor: toast.tone === "error" ? C.error : C.brand }]} testID="toast">
          <Ionicons
            name={toast.tone === "error" ? "alert-circle" : "checkmark-circle"}
            size={18}
            color={toast.tone === "error" ? C.error : C.brand}
          />
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: R.md, paddingVertical: 14, paddingHorizontal: SP.lg, alignItems: "center",
    justifyContent: "center", minHeight: 48,
  },
  btnText: { fontFamily: F.bodyBold, fontSize: 15, letterSpacing: 0.4 },
  label: { color: C.onSurface3, fontFamily: F.bodyBold, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 },
  input: {
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: R.md,
    color: C.onSurface, paddingHorizontal: SP.lg, paddingVertical: 13, fontFamily: F.body, fontSize: 15, minHeight: 48,
  },
  card: { backgroundColor: C.surface2, borderRadius: R.lg, borderWidth: 1, borderColor: C.border, padding: SP.lg },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SP.md, marginTop: SP.xl },
  sectionTitle: { color: C.onSurface, fontFamily: F.display, fontSize: 20, letterSpacing: 0.6, textTransform: "uppercase" },
  chip: {
    paddingHorizontal: SP.lg, height: 36, borderRadius: R.pill, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border, justifyContent: "center", flexShrink: 0,
  },
  chipText: { color: C.onSurface2, fontFamily: F.body, fontSize: 13 },
  empty: { alignItems: "center", paddingVertical: SP.xxxl, gap: SP.md },
  emptyText: { color: C.onSurface3, fontFamily: F.body, fontSize: 14, textAlign: "center", paddingHorizontal: SP.xl },
  badge: { borderRadius: R.sm, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontFamily: F.bodyBold, textTransform: "uppercase", letterSpacing: 0.5 },
  capRow: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  capTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.surface3, overflow: "hidden" },
  capFill: { height: 6, borderRadius: 3 },
  capText: { color: C.onSurface3, fontFamily: F.display, fontSize: 14 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)" },
  sheet: {
    backgroundColor: C.surface2, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg,
    padding: SP.xl, paddingBottom: SP.xxl, borderTopWidth: 1, borderColor: C.borderStrong,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.borderStrong, alignSelf: "center", marginBottom: SP.lg },
  sheetTitle: { color: C.onSurface, fontFamily: F.display, fontSize: 22, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: SP.lg },
  toast: {
    position: "absolute", bottom: 100, left: SP.lg, right: SP.lg, backgroundColor: C.surface3,
    borderRadius: R.md, borderWidth: 1, padding: SP.lg, flexDirection: "row", alignItems: "center", gap: SP.sm,
  },
  toastText: { color: C.onSurface, fontFamily: F.body, fontSize: 14, flex: 1 },
});
