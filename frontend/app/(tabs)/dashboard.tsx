import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import { Card, SectionTitle, EmptyState, Btn } from "@/src/components/UI";
import { C, SP, R, F } from "@/src/theme";

export default function Dashboard() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    try {
      const [d, n] = await Promise.all([api("/admin/dashboard"), api("/notifications")]);
      setData(d);
      setUnread(n.unread);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const Stat = ({ label, value, tone, testID }: any) => (
    <View style={[styles.stat, tone === "gold" && { borderColor: C.brandDark }]} testID={testID}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <View>
          <Text style={styles.hello}>ANAM MMA</Text>
          <Text style={styles.name}>COMMAND CENTER</Text>
        </View>
        <Pressable testID="notifications-bell" onPress={() => router.push("/notifications")} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="notifications" size={20} color={C.onSurface} />
          {unread > 0 && <View style={styles.dot} />}
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.brand} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <View style={styles.grid}>
          <Stat testID="stat-active-members" label="ACTIVE MEMBERS" value={data?.active_members ?? "—"} />
          <Stat testID="stat-revenue" label="REVENUE THIS MONTH" value={data ? `€${data.revenue_month.toFixed(0)}` : "—"} tone="gold" />
          <Stat testID="stat-signups" label="NEW SIGNUPS" value={data?.new_signups ?? "—"} />
          <Stat testID="stat-pending" label="PENDING APPROVALS" value={data?.pending_approvals ?? "—"} />
        </View>

        <View style={{ flexDirection: "row", gap: SP.sm, marginTop: SP.lg }}>
          <Card style={{ flex: 1, alignItems: "center" }} testID="stat-attendance">
            <Text style={styles.miniValue}>{data?.attendance_today ?? "—"}</Text>
            <Text style={styles.statLabel}>CHECKED IN TODAY</Text>
          </Card>
        </View>

        <SectionTitle>TODAY&apos;S CLASSES</SectionTitle>
        {(data?.todays_classes || []).length === 0 ? (
          <EmptyState text="No classes scheduled today." />
        ) : (
          data.todays_classes.map((c: any) => (
            <Card key={c.id} style={styles.row} testID={`dash-class-${c.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.time}>{c.start_time}</Text>
                <Text style={styles.rowTitle}>{c.name}</Text>
                <Text style={styles.meta}>
                  {c.coach?.name || "No coach"} • {c.booked_count}/{c.capacity} booked{c.cancelled ? " • CANCELLED" : ""}
                </Text>
              </View>
              {!c.cancelled && (
                <Btn
                  small
                  title="ROSTER"
                  testID={`dash-roster-${c.id}`}
                  variant="outline"
                  onPress={() => router.push({ pathname: "/checkin", params: { classId: c.id, date: today, name: c.name } })}
                />
              )}
            </Card>
          ))
        )}

        <SectionTitle>EXPIRING MEMBERSHIPS (7 DAYS)</SectionTitle>
        {(data?.expiring || []).length === 0 ? (
          <EmptyState icon="card-outline" text="No memberships expiring soon." />
        ) : (
          data.expiring.map((s: any) => (
            <Card key={s.id} style={[styles.row, { borderColor: "#3a2a10" }]} testID={`expiring-${s.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{s.user_name}</Text>
                <Text style={styles.meta}>
                  {s.plan_name} • expires {s.end_date}
                </Text>
              </View>
              <Ionicons name="hourglass" size={18} color={C.warning} />
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SP.lg, paddingBottom: SP.md, borderBottomWidth: 1, borderColor: C.border,
  },
  hello: { fontFamily: F.body, fontSize: 11, color: C.brand, letterSpacing: 2 },
  name: { fontFamily: F.display, fontSize: 26, color: C.onSurface, letterSpacing: 1 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: C.error },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SP.sm },
  stat: {
    width: "48.5%", backgroundColor: C.surface2, borderRadius: R.lg, borderWidth: 1,
    borderColor: C.border, padding: SP.lg, minHeight: 100, justifyContent: "center",
  },
  statValue: { fontFamily: F.display, fontSize: 40, color: C.onSurface },
  miniValue: { fontFamily: F.display, fontSize: 28, color: C.onSurface },
  statLabel: { fontFamily: F.body, fontSize: 10, color: C.onSurface3, letterSpacing: 1.2, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: SP.md, marginBottom: SP.sm },
  time: { fontFamily: F.display, fontSize: 15, color: C.brand },
  rowTitle: { fontFamily: F.bodyBold, fontSize: 15, color: C.onSurface },
  meta: { fontFamily: F.body, fontSize: 12, color: C.onSurface3, marginTop: 2 },
});
