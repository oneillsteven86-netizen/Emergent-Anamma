import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ScrollView, Share } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import { Btn, Input, Chip, EmptyState, Badge, Sheet, useToast } from "@/src/components/UI";
import { C, SP, R, F } from "@/src/theme";

const FILTERS = ["All", "Pending", "Active", "Unpaid", "Coaches"];
const PERMS: [string, string][] = [
  ["manage_timetable", "Manage timetable"],
  ["manage_members", "Manage members"],
  ["mark_attendance", "Mark attendance"],
  ["take_payments", "Accept cash payments"],
  ["manage_private_sessions", "Manage private sessions"],
  ["send_announcements", "Send announcements"],
];

export default function Members() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  // member detail
  const [sel, setSel] = useState<any>(null);
  const [selSubs, setSelSubs] = useState<any[]>([]);
  const [notes, setNotes] = useState("");
  const [showPlans, setShowPlans] = useState(false);
  // add member (cash, front desk)
  const [addOpen, setAddOpen] = useState(false);
  const [mName, setMName] = useState("");
  const [mEmail, setMEmail] = useState("");
  const [mPhone, setMPhone] = useState("");
  const [mPlan, setMPlan] = useState<string | null>(null);
  const [mPaid, setMPaid] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<any>(null);
  // add coach
  const [coachOpen, setCoachOpen] = useState(false);
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPass, setCPass] = useState("");
  const [cBio, setCBio] = useState("");
  const [cPerms, setCPerms] = useState<Record<string, boolean>>({ mark_attendance: true });

  const load = useCallback(async () => {
    try {
      const [u, p, s] = await Promise.all([api("/users"), api("/plans"), api("/subscriptions")]);
      setUsers(u);
      setPlans(p);
      setSubs(s);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const subFor = (uid: string) =>
    subs.find((s) => s.user_id === uid && ["active", "frozen", "pending_payment"].includes(s.status));

  const open = async (u: any) => {
    setSel(u);
    setNotes(u.admin_notes || "");
    setShowPlans(false);
    try {
      setSelSubs(await api(`/subscriptions?user_id=${u.id}`));
    } catch {
      setSelSubs([]);
    }
  };

  const update = async (id: string, body: any, msg?: string) => {
    try {
      const u = await api(`/users/${id}`, { method: "PUT", body });
      setSel(u);
      if (msg) toast.show(msg);
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const assignPlan = async (planId: string, markPaid: boolean) => {
    try {
      const sub = await api("/subscriptions", { method: "POST", body: { user_id: sel.id, plan_id: planId, mark_paid: markPaid } });
      toast.show(markPaid ? "Plan assigned & cash payment recorded ✓" : "Plan assigned — awaiting payment");
      setShowPlans(false);
      setSelSubs(await api(`/subscriptions?user_id=${sel.id}`));
      load();
      return sub;
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const subAction = async (subId: string, action: string) => {
    try {
      await api(`/subscriptions/${subId}/${action}`, { method: "POST" });
      toast.show(action === "mark-paid" ? "Cash payment recorded ✓" : `Membership ${action}d`);
      setSelSubs(await api(`/subscriptions?user_id=${sel.id}`));
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const createMember = async () => {
    if (!mName || !mEmail) return toast.show("Name and email required", "error");
    setCreating(true);
    try {
      const r = await api("/users/member", {
        method: "POST",
        body: { name: mName, email: mEmail, phone: mPhone, plan_id: mPlan, mark_paid: mPaid && !!mPlan },
      });
      setCreated(r);
      toast.show("Member added ✓");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setCreating(false);
    }
  };

  const resetAdd = () => {
    setAddOpen(false);
    setCreated(null);
    setMName(""); setMEmail(""); setMPhone(""); setMPlan(null); setMPaid(true);
  };

  const createCoach = async () => {
    if (!cName || !cEmail || !cPass) return toast.show("Name, email & password required", "error");
    try {
      await api("/users/coach", { method: "POST", body: { name: cName, email: cEmail, password: cPass, bio: cBio, permissions: cPerms } });
      toast.show("Coach added");
      setCoachOpen(false);
      setCName(""); setCEmail(""); setCPass(""); setCBio("");
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

  const filtered = users.filter((u) => {
    if (filter === "Pending" && u.status !== "pending") return false;
    if (filter === "Active" && !(u.status === "active" && u.role === "member")) return false;
    if (filter === "Coaches" && u.role !== "coach") return false;
    if (filter === "Unpaid" && !(u.role === "member" && subFor(u.id)?.status === "pending_payment")) return false;
    if (search && !`${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const currentSub = sel ? selSubs.find((s) => ["active", "frozen", "pending_payment"].includes(s.status)) : null;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <Text style={styles.title}>MEMBERS</Text>
        <View style={{ flexDirection: "row", gap: SP.xs }}>
          <Pressable testID="export-members-button" onPress={() => exportCsv("members")} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="download" size={20} color={C.onSurface3} />
          </Pressable>
          <Pressable testID="add-coach-button" onPress={() => setCoachOpen(true)} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="school" size={20} color={C.onSurface3} />
          </Pressable>
        </View>
      </View>

      <View style={{ paddingHorizontal: SP.lg, paddingTop: SP.md }}>
        <Btn testID="add-member-button" title="+ ADD MEMBER  (CASH AT DESK)" onPress={() => setAddOpen(true)} />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={C.onSurface3} />
        <TextInput
          testID="members-search-input"
          style={styles.search}
          placeholder="Search name or email…"
          placeholderTextColor={C.onSurface3}
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <View style={{ height: 56, justifyContent: "center" }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.lg }}>
          {FILTERS.map((f) => (
            <Chip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} testID={`filter-${f.toLowerCase()}`} />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: SP.lg, paddingBottom: SP.xxl }}
        ListEmptyComponent={<EmptyState icon="people-outline" text="No members found." />}
        renderItem={({ item }) => {
          const s = item.role === "member" ? subFor(item.id) : null;
          return (
            <Pressable testID={`member-row-${item.id}`} style={styles.row} onPress={() => open(item)}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name?.charAt(0)?.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {item.role === "member"
                    ? s
                      ? `${s.plan_name} • ${s.status === "pending_payment" ? "UNPAID" : s.status === "frozen" ? "frozen" : `until ${s.end_date}`}`
                      : "No membership"
                    : item.email}
                </Text>
              </View>
              {item.deletion_requested && <Badge text="GDPR" tone="error" />}
              {item.role === "member" && s?.status === "pending_payment" && <Badge text="€ due" tone="warning" />}
              <Badge
                text={item.role === "coach" ? "Coach" : item.role === "admin" ? "Admin" : item.status}
                tone={item.role !== "member" ? "gold" : item.status === "active" ? "success" : item.status === "pending" ? "warning" : "neutral"}
              />
            </Pressable>
          );
        }}
      />

      {/* ---------- ADD MEMBER (front desk / cash) ---------- */}
      <Sheet visible={addOpen} onClose={resetAdd} title="ADD MEMBER">
        {created ? (
          <View>
            <View style={styles.successBox} testID="member-created-box">
              <Ionicons name="checkmark-circle" size={40} color={C.brand} />
              <Text style={styles.successTitle}>{created.user.name} added</Text>
              <Text style={styles.rowMeta}>Login email: {created.user.email}</Text>
              <Text style={[styles.rowName, { marginTop: 4 }]}>Temp password: {created.temp_password}</Text>
              {created.subscription && (
                <Text style={[styles.rowMeta, { marginTop: 4 }]}>
                  {created.subscription.plan_name} — {created.subscription.status === "active" ? "PAID ✓ (cash)" : "awaiting payment"}
                </Text>
              )}
            </View>
            <Btn
              testID="share-credentials-button"
              variant="outline"
              title="SHARE LOGIN DETAILS"
              onPress={() => Share.share({ message: `Welcome to ANAM MMA!\nLogin: ${created.user.email}\nTemporary password: ${created.temp_password}\nDownload the app and sign in to book classes.` })}
            />
            <Btn testID="add-another-member-button" title="ADD ANOTHER" onPress={() => { setCreated(null); setMName(""); setMEmail(""); setMPhone(""); }} style={{ marginTop: SP.sm }} />
            <Btn testID="done-add-member-button" variant="outline" title="DONE" onPress={resetAdd} style={{ marginTop: SP.sm }} />
          </View>
        ) : (
          <View>
            <Input testID="new-member-name-input" label="Full name" value={mName} onChangeText={setMName} placeholder="Conor Walsh" autoCapitalize="words" />
            <Input testID="new-member-email-input" label="Email" value={mEmail} onChangeText={setMEmail} placeholder="member@email.com" autoCapitalize="none" keyboardType="email-address" />
            <Input testID="new-member-phone-input" label="Phone (optional)" value={mPhone} onChangeText={setMPhone} keyboardType="phone-pad" placeholder="+353…" />
            <Text style={styles.label}>MEMBERSHIP PLAN (TAP TO SELECT)</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SP.sm, marginBottom: SP.md }}>
              <Chip label="No plan yet" active={mPlan === null} onPress={() => setMPlan(null)} testID="new-member-plan-none" />
              {plans.map((p) => (
                <Chip key={p.id} label={`${p.name} €${p.price}`} active={mPlan === p.id} onPress={() => setMPlan(p.id)} testID={`new-member-plan-${p.id}`} />
              ))}
            </View>
            {mPlan && (
              <Pressable testID="cash-received-toggle" style={styles.cashRow} onPress={() => setMPaid(!mPaid)}>
                <Ionicons name={mPaid ? "checkbox" : "square-outline"} size={24} color={mPaid ? C.brand : C.onSurface3} />
                <Text style={styles.cashText}>Cash received — mark paid & issue receipt now</Text>
              </Pressable>
            )}
            <Btn testID="create-member-button" title="CREATE MEMBER" onPress={createMember} loading={creating} />
            <Text style={[styles.rowMeta, { marginTop: SP.sm, textAlign: "center" }]}>
              A temporary password is generated automatically — share it after creating.
            </Text>
          </View>
        )}
      </Sheet>

      {/* ---------- MEMBER DETAIL ---------- */}
      <Sheet visible={!!sel} onClose={() => setSel(null)} title={sel?.name?.toUpperCase()}>
        {sel && (
          <View>
            {/* quick status + actions */}
            <View style={{ flexDirection: "row", gap: SP.sm, flexWrap: "wrap", marginBottom: SP.md }}>
              <Badge text={sel.role} tone="gold" />
              <Badge text={sel.status} tone={sel.status === "active" ? "success" : "warning"} />
              {currentSub && (
                <Badge
                  text={currentSub.status === "pending_payment" ? "PAYMENT DUE" : currentSub.status}
                  tone={currentSub.status === "active" ? "success" : currentSub.status === "pending_payment" ? "warning" : "neutral"}
                />
              )}
              {sel.deletion_requested && <Badge text="GDPR DELETE REQUESTED" tone="error" />}
            </View>

            {sel.status === "pending" && (
              <Btn testID="approve-member-button" title="✓ APPROVE MEMBER" onPress={() => update(sel.id, { status: "active" }, "Member approved")} style={{ marginBottom: SP.sm }} />
            )}
            {currentSub?.status === "pending_payment" && (
              <Btn testID={`mark-paid-${currentSub.id}`} title={`€ MARK CASH PAID — ${currentSub.plan_name} (€${currentSub.price})`} onPress={() => subAction(currentSub.id, "mark-paid")} style={{ marginBottom: SP.sm }} />
            )}

            {/* contact */}
            <Text style={styles.subhead}>CONTACT</Text>
            <Text style={styles.detailMeta}>{sel.email}{sel.phone ? ` • ${sel.phone}` : ""}</Text>
            <Text style={styles.detailMeta}>
              Waiver: {sel.waiver_accepted ? `✓ v${sel.waiver_version} on ${(sel.waiver_accepted_at || "").slice(0, 10)}` : "✗ not accepted yet"}
            </Text>
            {sel.emergency_contact_name ? <Text style={styles.detailMeta}>ICE: {sel.emergency_contact_name} ({sel.emergency_contact_phone})</Text> : null}
            {sel.medical_notes ? <Text style={[styles.detailMeta, { color: C.warning }]}>⚕ {sel.medical_notes}</Text> : null}

            {/* coach permissions */}
            {sel.role === "coach" && (
              <View>
                <Text style={styles.subhead}>COACH PERMISSIONS</Text>
                {PERMS.map(([key, label]) => (
                  <Pressable key={key} testID={`perm-${key}`} style={styles.permRow}
                    onPress={() => update(sel.id, { permissions: { ...sel.permissions, [key]: !sel.permissions?.[key] } })}>
                    <Text style={styles.permLabel}>{label}</Text>
                    <Ionicons name={sel.permissions?.[key] ? "checkmark-circle" : "ellipse-outline"} size={22} color={sel.permissions?.[key] ? C.brand : C.onSurface3} />
                  </Pressable>
                ))}
              </View>
            )}

            {/* membership */}
            {sel.role === "member" && (
              <View>
                <Text style={styles.subhead}>MEMBERSHIP</Text>
                {selSubs.length === 0 && <Text style={styles.detailMeta}>No membership yet.</Text>}
                {selSubs.slice(0, 3).map((s) => (
                  <View key={s.id} style={styles.subCard}>
                    <Text style={styles.rowName}>{s.plan_name} — €{s.price}</Text>
                    <Text style={styles.rowMeta}>
                      {s.status.replace("_", " ")} • {s.start_date} → {s.end_date}
                      {s.sessions_remaining != null ? ` • ${s.sessions_remaining} left` : ""}
                    </Text>
                    <View style={{ flexDirection: "row", gap: SP.sm, marginTop: SP.sm }}>
                      {s.status === "pending_payment" && <Btn small title="MARK CASH PAID" testID={`mark-paid-row-${s.id}`} onPress={() => subAction(s.id, "mark-paid")} />}
                      {s.status === "active" && <Btn small title="FREEZE" variant="outline" testID={`freeze-${s.id}`} onPress={() => subAction(s.id, "freeze")} />}
                      {s.status === "frozen" && <Btn small title="RESUME" testID={`resume-${s.id}`} onPress={() => subAction(s.id, "resume")} />}
                    </View>
                  </View>
                ))}
                {showPlans ? (
                  <View>
                    <Text style={[styles.rowMeta, { marginBottom: SP.sm }]}>Tap a plan — cash payment is recorded immediately:</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SP.sm }}>
                      {plans.map((p) => (
                        <Chip key={p.id} label={`${p.name} €${p.price}`} onPress={() => assignPlan(p.id, true)} testID={`assign-plan-${p.id}`} />
                      ))}
                    </View>
                    <Btn small variant="outline" title="ASSIGN WITHOUT PAYMENT" testID="assign-unpaid-hint" style={{ marginTop: SP.sm }}
                      onPress={() => toast.show("Long-press not needed — tap a plan above; use MARK PAID later if collecting cash another day", "error")} />
                  </View>
                ) : (
                  <Btn small variant="outline" title="+ SELL / RENEW PLAN (CASH)" testID="show-plans-button" onPress={() => setShowPlans(true)} />
                )}
              </View>
            )}

            {/* notes */}
            <Text style={styles.subhead}>ADMIN NOTES</Text>
            <Input testID="admin-notes-input" value={notes} onChangeText={setNotes} placeholder="Private notes about this member…" multiline style={{ height: 64, textAlignVertical: "top" }} />
            <Btn small title="SAVE NOTES" testID="save-notes-button" variant="outline" onPress={() => update(sel.id, { admin_notes: notes }, "Notes saved")} />

            {/* danger zone */}
            {user?.role === "admin" && sel.role !== "admin" && (
              <View style={{ marginTop: SP.lg, gap: SP.sm }}>
                {sel.role === "member" && (
                  <Btn small title="PROMOTE TO COACH" variant="outline" testID="promote-coach-button"
                    onPress={async () => {
                      try {
                        await api(`/users/${sel.id}/promote-coach`, { method: "POST" });
                        toast.show(`${sel.name} is now a coach`);
                        setSel(null);
                        load();
                      } catch (e: any) { toast.show(e.message, "error"); }
                    }} />
                )}
                <Btn small title="PROMOTE TO ADMIN (HANDOVER)" variant="outline" testID="promote-admin-button"
                  onPress={async () => {
                    try {
                      await api(`/users/${sel.id}/promote-admin`, { method: "POST" });
                      toast.show(`${sel.name} is now an admin`);
                      setSel(null);
                      load();
                    } catch (e: any) { toast.show(e.message, "error"); }
                  }} />
                <Btn small title="REMOVE MEMBER" variant="danger" testID="remove-member-button"
                  onPress={async () => {
                    try {
                      await api(`/users/${sel.id}`, { method: "DELETE" });
                      toast.show("Member removed");
                      setSel(null);
                      load();
                    } catch (e: any) { toast.show(e.message, "error"); }
                  }} />
              </View>
            )}
          </View>
        )}
      </Sheet>

      {/* ---------- ADD COACH ---------- */}
      <Sheet visible={coachOpen} onClose={() => setCoachOpen(false)} title="ADD COACH">
        <Input testID="coach-name-input" label="Name" value={cName} onChangeText={setCName} placeholder="Coach name" />
        <Input testID="coach-email-input" label="Email" value={cEmail} onChangeText={setCEmail} autoCapitalize="none" keyboardType="email-address" placeholder="coach@email.com" />
        <Input testID="coach-password-input" label="Password" value={cPass} onChangeText={setCPass} secureTextEntry placeholder="Temporary password" />
        <Input testID="coach-bio-input" label="Bio" value={cBio} onChangeText={setCBio} placeholder="Coach bio shown to members" multiline style={{ height: 64, textAlignVertical: "top" }} />
        <Text style={styles.subhead}>PERMISSIONS</Text>
        {PERMS.map(([key, label]) => (
          <Pressable key={key} testID={`new-coach-perm-${key}`} style={styles.permRow} onPress={() => setCPerms({ ...cPerms, [key]: !cPerms[key] })}>
            <Text style={styles.permLabel}>{label}</Text>
            <Ionicons name={cPerms[key] ? "checkmark-circle" : "ellipse-outline"} size={22} color={cPerms[key] ? C.brand : C.onSurface3} />
          </Pressable>
        ))}
        <Btn testID="create-coach-button" title="CREATE COACH" onPress={createCoach} style={{ marginTop: SP.md }} />
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
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: SP.sm, backgroundColor: C.surface2,
    marginHorizontal: SP.lg, marginTop: SP.md, borderRadius: R.md, borderWidth: 1, borderColor: C.border, paddingHorizontal: SP.md,
  },
  search: { flex: 1, color: C.onSurface, fontFamily: F.body, paddingVertical: 11, fontSize: 14 },
  row: {
    flexDirection: "row", alignItems: "center", gap: SP.md, backgroundColor: C.surface2,
    borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: SP.md, marginBottom: SP.sm,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.brandTint, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: F.display, fontSize: 17, color: C.onBrandTint },
  rowName: { fontFamily: F.bodyBold, fontSize: 14, color: C.onSurface },
  rowMeta: { fontFamily: F.body, fontSize: 12, color: C.onSurface3, marginTop: 2 },
  detailMeta: { fontFamily: F.body, fontSize: 13, color: C.onSurface3, marginBottom: 4, lineHeight: 19 },
  subhead: { fontFamily: F.display, fontSize: 16, color: C.brand, letterSpacing: 1, marginTop: SP.lg, marginBottom: SP.sm },
  permRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border,
  },
  permLabel: { fontFamily: F.body, fontSize: 14, color: C.onSurface2 },
  subCard: { backgroundColor: C.surface3, borderRadius: R.md, padding: SP.md, marginBottom: SP.sm },
  label: { color: C.onSurface3, fontFamily: F.bodyBold, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 },
  cashRow: { flexDirection: "row", alignItems: "center", gap: SP.md, paddingVertical: SP.md, marginBottom: SP.sm },
  cashText: { flex: 1, fontFamily: F.bodyBold, fontSize: 14, color: C.onSurface },
  successBox: { alignItems: "center", gap: 4, backgroundColor: C.surface3, borderRadius: R.lg, padding: SP.xl, marginBottom: SP.lg },
  successTitle: { fontFamily: F.display, fontSize: 22, color: C.onSurface, marginTop: SP.sm },
});
