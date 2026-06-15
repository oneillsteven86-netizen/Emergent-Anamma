import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, Share } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import { Btn, Input, Card, SectionTitle, useToast, Sheet, Badge } from "@/src/components/UI";
import { C, SP, F } from "@/src/theme";

export default function Profile() {
  const { user, refresh, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [payments, setPayments] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [receipt, setReceipt] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api("/payments/me"), api("/subscriptions/me")]);
      setPayments(p);
      setSubs(s);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openEdit = () => {
    setForm({
      name: user?.name, email: user?.email, phone: user?.phone,
      emergency_contact_name: user?.emergency_contact_name,
      emergency_contact_phone: user?.emergency_contact_phone,
      medical_notes: user?.medical_notes, password: "",
    });
    setEditOpen(true);
  };

  const save = async () => {
    try {
      const body: any = { ...form };
      if (!body.password) delete body.password;
      await api("/auth/profile", { method: "PUT", body });
      await refresh();
      toast.show("Profile updated");
      setEditOpen(false);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const viewReceipt = async (p: any) => {
    try {
      setReceipt(await api(`/payments/${p.id}/receipt`));
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const shareReceipt = async () => {
    if (!receipt) return;
    await Share.share({
      message: `ANAM MMA RECEIPT\n${receipt.receipt_no}\nDate: ${receipt.date}\nMember: ${receipt.member}\nPlan: ${receipt.plan}\nAmount: €${receipt.amount}\nMethod: ${receipt.method}`,
    });
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <Text style={styles.title}>PROFILE</Text>
        <Pressable testID="notifications-bell" onPress={() => router.push("/notifications")} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="notifications" size={20} color={C.onSurface} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xxl }} keyboardShouldPersistTaps="handled">
        <Card style={{ flexDirection: "row", alignItems: "center", gap: SP.lg }}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.charAt(0)?.toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.meta}>{user?.email}</Text>
            <View style={{ marginTop: 6 }}>
              <Badge text={user?.role || "member"} tone="gold" />
            </View>
          </View>
          <Pressable testID="edit-profile-button" onPress={openEdit} hitSlop={10}>
            <Ionicons name="pencil" size={20} color={C.brand} />
          </Pressable>
        </Card>

        {user?.role === "member" && (
          <>
            <SectionTitle>EMERGENCY & MEDICAL</SectionTitle>
            <Card>
              <Text style={styles.meta}>
                Emergency contact: {user?.emergency_contact_name ? `${user.emergency_contact_name} (${user.emergency_contact_phone})` : "Not set — please add one"}
              </Text>
              <Text style={[styles.meta, { marginTop: 4 }]}>Medical notes: {user?.medical_notes || "None"}</Text>
            </Card>

            <SectionTitle>MEMBERSHIP</SectionTitle>
            {subs.length === 0 ? (
              <Card><Text style={styles.meta}>No membership yet — ask at the front desk.</Text></Card>
            ) : (
              subs.map((s) => (
                <Card key={s.id} style={{ marginBottom: SP.sm }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{s.plan_name}</Text>
                      <Text style={styles.meta}>
                        {s.start_date} → {s.end_date}
                        {s.sessions_remaining != null ? ` • ${s.sessions_remaining} sessions left` : ""}
                      </Text>
                    </View>
                    <Badge text={s.status.replace("_", " ")} tone={s.status === "active" ? "success" : s.status === "frozen" ? "warning" : "neutral"} />
                  </View>
                </Card>
              ))
            )}
          </>
        )}

        <SectionTitle>PAYMENT HISTORY</SectionTitle>
        {payments.length === 0 ? (
          <Card><Text style={styles.meta}>No payments recorded.</Text></Card>
        ) : (
          payments.map((p) => (
            <Card key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: SP.md, marginBottom: SP.sm }} testID={`payment-${p.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>€{p.amount} — {p.plan_name}</Text>
                <Text style={styles.meta}>{p.created_at.slice(0, 10)} • {p.method} • {p.receipt_no}</Text>
              </View>
              <Btn small variant="outline" title="RECEIPT" testID={`receipt-${p.id}`} onPress={() => viewReceipt(p)} />
            </Card>
          ))
        )}

        <SectionTitle>LEGAL & DATA</SectionTitle>
        <View style={{ gap: SP.sm }}>
          <Btn variant="outline" testID="legal-button" title="TERMS & PRIVACY POLICY" onPress={() => router.push("/legal")} />
          {user?.role === "member" && (
            <Btn variant="outline" testID="gdpr-delete-button" title="REQUEST DATA / ACCOUNT DELETION (GDPR)" onPress={requestDeletion} />
          )}
          <Btn
            variant="danger"
            testID="logout-button"
            title="LOG OUT"
            onPress={async () => {
              await logout();
              router.replace("/login");
            }}
          />
        </View>
      </KeyboardAwareScrollView>

      <Sheet visible={editOpen} onClose={() => setEditOpen(false)} title="EDIT PROFILE">
        <Input testID="profile-name-input" label="Name" value={form.name} onChangeText={(v: string) => setForm({ ...form, name: v })} />
        <Input testID="profile-email-input" label="Email" value={form.email} onChangeText={(v: string) => setForm({ ...form, email: v })} autoCapitalize="none" keyboardType="email-address" />
        <Input testID="profile-phone-input" label="Phone" value={form.phone} onChangeText={(v: string) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
        {user?.role === "member" && (
          <>
            <Input testID="profile-ice-name-input" label="Emergency contact name" value={form.emergency_contact_name} onChangeText={(v: string) => setForm({ ...form, emergency_contact_name: v })} />
            <Input testID="profile-ice-phone-input" label="Emergency contact phone" value={form.emergency_contact_phone} onChangeText={(v: string) => setForm({ ...form, emergency_contact_phone: v })} keyboardType="phone-pad" />
            <Input testID="profile-medical-input" label="Medical notes (visible to coaches)" value={form.medical_notes} onChangeText={(v: string) => setForm({ ...form, medical_notes: v })} multiline style={{ height: 70, textAlignVertical: "top" }} />
          </>
        )}
        <Input testID="profile-password-input" label="New password (leave blank to keep)" value={form.password} onChangeText={(v: string) => setForm({ ...form, password: v })} secureTextEntry />
        {user?.role === "admin" && (
          <Text style={[styles.meta, { marginBottom: SP.md }]}>
            Handover tip: change your email here, or promote another user to admin from the Members tab.
          </Text>
        )}
        <Btn testID="profile-save-button" title="SAVE" onPress={save} />
      </Sheet>

      <Sheet visible={!!receipt} onClose={() => setReceipt(null)} title="RECEIPT">
        {receipt && (
          <View>
            <Text style={styles.receiptNo}>{receipt.receipt_no}</Text>
            {[
              ["Date", receipt.date],
              ["Member", receipt.member],
              ["Plan", receipt.plan],
              ["Amount", `€${receipt.amount}`],
              ["Method", receipt.method],
              ["Issued by", receipt.club],
            ].map(([k, v]) => (
              <View key={k as string} style={styles.receiptRow}>
                <Text style={styles.meta}>{k}</Text>
                <Text style={styles.rowTitle}>{v}</Text>
              </View>
            ))}
            <Btn testID="share-receipt-button" title="SHARE / DOWNLOAD" onPress={shareReceipt} style={{ marginTop: SP.lg }} />
          </View>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SP.lg, paddingBottom: SP.md, borderBottomWidth: 1, borderColor: C.border,
  },
  title: { fontFamily: F.display, fontSize: 26, color: C.onSurface, letterSpacing: 1 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.brandTint, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: F.display, fontSize: 26, color: C.onBrandTint },
  name: { fontFamily: F.display, fontSize: 22, color: C.onSurface },
  meta: { fontFamily: F.body, fontSize: 13, color: C.onSurface3, lineHeight: 19 },
  rowTitle: { fontFamily: F.bodyBold, fontSize: 14, color: C.onSurface },
  receiptNo: { fontFamily: F.display, fontSize: 22, color: C.brand, marginBottom: SP.md },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderColor: C.border },
});
