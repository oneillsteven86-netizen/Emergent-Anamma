import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, Share } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { api } from "@/src/api";
import { Btn, Input, Chip, Card, Sheet, useToast, SectionTitle } from "@/src/components/UI";
import { C, SP, R, F } from "@/src/theme";

const SECTIONS = ["Plans", "Announce", "Settings", "Media", "Exports"];

export default function Manage() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [section, setSection] = useState("Plans");
  const [plans, setPlans] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [planOpen, setPlanOpen] = useState(false);
  const [pf, setPf] = useState<any>({});
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [annAudience, setAnnAudience] = useState<string>("all");
  const [annClass, setAnnClass] = useState<string | null>(null);
  const [window, setWindow] = useState("");
  const [clubEmail, setClubEmail] = useState("");
  const [psPolicy, setPsPolicy] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, s, c] = await Promise.all([api("/plans"), api("/settings"), api("/classes")]);
      setPlans(p);
      setSettings(s);
      setClasses(c);
      setWindow(String(s.cancellation_window_hours ?? 2));
      setClubEmail(s.club_email || "");
      setPsPolicy(s.private_session_policy || "");
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const savePlan = async () => {
    if (!pf.name || !pf.price) return toast.show("Name and price required", "error");
    const body = {
      name: pf.name, price: Number(pf.price), type: pf.type || "monthly",
      duration_days: Number(pf.duration_days) || 30,
      sessions: pf.type === "class_pack" ? Number(pf.sessions) || 10 : null,
      description: pf.description || "",
    };
    try {
      if (pf.id) await api(`/plans/${pf.id}`, { method: "PUT", body });
      else await api("/plans", { method: "POST", body });
      toast.show("Plan saved");
      setPlanOpen(false);
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const sendAnn = async () => {
    if (!annTitle || !annBody) return toast.show("Title and message required", "error");
    try {
      const r = await api("/announcements", {
        method: "POST",
        body: { title: annTitle, body: annBody, audience: annAudience, class_id: annAudience === "class" ? annClass : null },
      });
      toast.show(`Sent to ${r.recipients} members`);
      setAnnTitle(""); setAnnBody("");
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const saveSettings = async (extra: any = {}) => {
    try {
      const s = await api("/admin/settings", {
        method: "PUT",
        body: {
          cancellation_window_hours: Number(window) || 2,
          club_email: clubEmail,
          private_session_policy: psPolicy,
          ...extra,
        },
      });
      setSettings(s);
      toast.show("Settings saved");
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const pickMedia = async (key: string) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.show("Photo library permission needed to upload media", "error");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.5, base64: true });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    try {
      await api("/admin/media", { method: "POST", body: { key, image: `data:image/jpeg;base64,${res.assets[0].base64}` } });
      toast.show("Media updated");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const exportCsv = async (kind: string) => {
    try {
      const csv = await api(`/export/${kind}.csv`, { raw: true });
      await Share.share({ message: csv, title: `${kind}.csv` });
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <Text style={styles.title}>MANAGE CLUB</Text>
      </View>
      <View style={{ height: 56, justifyContent: "center", borderBottomWidth: 1, borderColor: C.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.lg }}>
          {SECTIONS.map((s) => (
            <Chip key={s} label={s} active={section === s} onPress={() => setSection(s)} testID={`manage-section-${s.toLowerCase()}`} />
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xxl }} keyboardShouldPersistTaps="handled">
        {section === "Plans" && (
          <View>
            <Btn testID="add-plan-button" title="+ NEW PLAN" onPress={() => { setPf({ type: "monthly" }); setPlanOpen(true); }} style={{ marginBottom: SP.lg }} />
            {plans.map((p) => (
              <Card key={p.id} style={styles.row} testID={`plan-${p.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {p.name} — €{p.price}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {p.type} • {p.duration_days} days{p.sessions ? ` • ${p.sessions} sessions` : ""}
                  </Text>
                </View>
                <Pressable testID={`edit-plan-${p.id}`} onPress={() => { setPf(p); setPlanOpen(true); }} hitSlop={10}>
                  <Ionicons name="pencil" size={18} color={C.brand} />
                </Pressable>
                <Pressable
                  testID={`delete-plan-${p.id}`}
                  onPress={async () => {
                    await api(`/plans/${p.id}`, { method: "DELETE" });
                    toast.show("Plan removed");
                    load();
                  }}
                  hitSlop={10}
                >
                  <Ionicons name="trash" size={18} color={C.error} />
                </Pressable>
              </Card>
            ))}
          </View>
        )}

        {section === "Announce" && (
          <View>
            <Input testID="ann-title-input" label="Title" value={annTitle} onChangeText={setAnnTitle} placeholder="e.g. Christmas opening hours" />
            <Input testID="ann-body-input" label="Message" value={annBody} onChangeText={setAnnBody} multiline style={{ height: 100, textAlignVertical: "top" }} placeholder="Write your announcement…" />
            <Text style={styles.label}>AUDIENCE</Text>
            <View style={{ height: 56, justifyContent: "center" }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm }}>
                <Chip label="All members" active={annAudience === "all"} onPress={() => setAnnAudience("all")} testID="audience-all" />
                {classes.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    active={annAudience === "class" && annClass === c.id}
                    onPress={() => { setAnnAudience("class"); setAnnClass(c.id); }}
                    testID={`audience-class-${c.id}`}
                  />
                ))}
              </ScrollView>
            </View>
            <Btn testID="send-announcement-button" title="SEND ANNOUNCEMENT" onPress={sendAnn} style={{ marginTop: SP.sm }} />
          </View>
        )}

        {section === "Settings" && (
          <View>
            <Card style={[styles.row, { marginBottom: SP.lg }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Open registration</Text>
                <Text style={styles.rowMeta}>OFF = new members need admin approval before booking</Text>
              </View>
              <Switch
                testID="open-registration-switch"
                value={!!settings.open_registration}
                onValueChange={(v) => saveSettings({ open_registration: v })}
                trackColor={{ true: C.brand, false: C.surface3 }}
                thumbColor={C.onSurface}
              />
            </Card>
            <Input testID="cancel-window-input" label="Booking cancellation window (hours before class)" value={window} onChangeText={setWindow} keyboardType="numeric" />
            <Input testID="club-email-input" label="Club reply-to email" value={clubEmail} onChangeText={setClubEmail} autoCapitalize="none" placeholder="info@anammma.com" />
            <Input testID="ps-policy-input" label="Private session cancellation policy" value={psPolicy} onChangeText={setPsPolicy} multiline style={{ height: 80, textAlignVertical: "top" }} />
            <Btn testID="save-settings-button" title="SAVE SETTINGS" onPress={() => saveSettings()} />
          </View>
        )}

        {section === "Media" && (
          <View>
            <SectionTitle>CLUB MEDIA</SectionTitle>
            {[
              ["login_bg", "Login background"],
              ["logo", "Club logo"],
              ["banner", "Home banner"],
            ].map(([key, label]) => (
              <Card key={key} style={[styles.row, { marginBottom: SP.sm }]}>
                {settings?.media?.[key] ? (
                  <Image source={{ uri: settings.media[key] }} style={styles.mediaThumb} />
                ) : (
                  <View style={[styles.mediaThumb, { backgroundColor: C.surface3 }]} />
                )}
                <Text style={[styles.rowTitle, { flex: 1 }]}>{label}</Text>
                <Btn small variant="outline" title="REPLACE" testID={`media-${key}-button`} onPress={() => pickMedia(key as string)} />
              </Card>
            ))}
            <Text style={styles.rowMeta}>Coach photos can be updated per coach in the Members tab. Class images via Timetable → Edit class.</Text>
          </View>
        )}

        {section === "Exports" && (
          <View style={{ gap: SP.md }}>
            <Btn testID="export-members-csv" title="EXPORT MEMBERS CSV" variant="outline" onPress={() => exportCsv("members")} />
            <Btn testID="export-payments-csv" title="EXPORT PAYMENTS CSV" variant="outline" onPress={() => exportCsv("payments")} />
            <Text style={styles.rowMeta}>CSV opens in the share sheet — send to email, files or any app.</Text>
          </View>
        )}
      </ScrollView>

      <Sheet visible={planOpen} onClose={() => setPlanOpen(false)} title={pf.id ? "EDIT PLAN" : "NEW PLAN"}>
        <Input testID="plan-name-input" label="Name" value={pf.name} onChangeText={(v: string) => setPf({ ...pf, name: v })} placeholder="e.g. Unlimited Monthly" />
        <View style={{ flexDirection: "row", gap: SP.sm }}>
          <View style={{ flex: 1 }}>
            <Input testID="plan-price-input" label="Price €" value={String(pf.price ?? "")} onChangeText={(v: string) => setPf({ ...pf, price: v })} keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <Input testID="plan-duration-input" label="Days valid" value={String(pf.duration_days ?? "")} onChangeText={(v: string) => setPf({ ...pf, duration_days: v })} keyboardType="numeric" />
          </View>
        </View>
        <Text style={styles.label}>TYPE</Text>
        <View style={{ flexDirection: "row", gap: SP.sm, marginBottom: SP.md }}>
          {["monthly", "trial", "class_pack"].map((t) => (
            <Chip key={t} label={t.replace("_", " ")} active={pf.type === t} onPress={() => setPf({ ...pf, type: t })} testID={`plan-type-${t}`} />
          ))}
        </View>
        {pf.type === "class_pack" && (
          <Input testID="plan-sessions-input" label="Number of sessions" value={String(pf.sessions ?? "")} onChangeText={(v: string) => setPf({ ...pf, sessions: v })} keyboardType="numeric" />
        )}
        <Input testID="plan-desc-input" label="Description" value={pf.description} onChangeText={(v: string) => setPf({ ...pf, description: v })} />
        <Btn testID="save-plan-button" title="SAVE PLAN" onPress={savePlan} />
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
  row: { flexDirection: "row", alignItems: "center", gap: SP.md, marginBottom: SP.sm },
  rowTitle: { fontFamily: F.bodyBold, fontSize: 14, color: C.onSurface },
  rowMeta: { fontFamily: F.body, fontSize: 12, color: C.onSurface3, marginTop: 2, lineHeight: 17 },
  label: { color: C.onSurface3, fontFamily: F.bodyBold, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 },
  mediaThumb: { width: 56, height: 40, borderRadius: R.sm },
});
