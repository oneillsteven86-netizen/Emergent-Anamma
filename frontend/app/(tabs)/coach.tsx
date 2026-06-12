import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import { Card, SectionTitle, EmptyState, Btn, Input, Sheet, useToast, Badge } from "@/src/components/UI";
import { C, SP, F } from "@/src/theme";

export default function CoachToday() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [classes, setClasses] = useState<any[]>([]);
  const [privates, setPrivates] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [annOpen, setAnnOpen] = useState(false);
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [sending, setSending] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    try {
      const [sched, ps, n] = await Promise.all([api(`/schedule?date=${today}`), api("/private-sessions/me"), api("/notifications")]);
      setClasses(sched);
      setPrivates(ps.filter((x: any) => x.status === "requested" || (x.status === "confirmed" && x.date >= today)));
      setUnread(n.unread);
    } catch {}
  }, [today]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const canAnnounce = user?.permissions?.send_announcements;
  const canAttend = user?.permissions?.mark_attendance;
  const mine = classes.filter((c) => c.coach?.id === user?.id);
  const others = classes.filter((c) => c.coach?.id !== user?.id);

  const sendAnn = async () => {
    if (!annTitle || !annBody) return toast.show("Title and message required", "error");
    setSending(true);
    try {
      const r = await api("/announcements", { method: "POST", body: { title: annTitle, body: annBody, audience: "all" } });
      toast.show(`Announcement sent to ${r.recipients} members`);
      setAnnOpen(false);
      setAnnTitle("");
      setAnnBody("");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setSending(false);
    }
  };

  const updatePs = async (id: string, status: string) => {
    try {
      await api(`/private-sessions/${id}`, { method: "PUT", body: { status } });
      toast.show(`Session ${status}`);
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const ClassRow = ({ c }: any) => (
    <Card style={styles.row} testID={`coach-class-${c.id}`}>
      <View style={{ flex: 1 }}>
        <Text style={styles.time}>{c.start_time}</Text>
        <Text style={styles.title}>{c.name}</Text>
        <Text style={styles.meta}>
          {c.room} • {c.booked_count}/{c.capacity} booked {c.cancelled ? "• CANCELLED" : ""}
        </Text>
      </View>
      {canAttend && !c.cancelled && (
        <Btn
          small
          testID={`open-checkin-${c.id}`}
          title="CHECK-IN"
          onPress={() => router.push({ pathname: "/checkin", params: { classId: c.id, date: today, name: c.name } })}
        />
      )}
    </Card>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <View>
          <Text style={styles.hello}>COACH</Text>
          <Text style={styles.name}>{user?.name?.toUpperCase()}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: SP.sm }}>
          {canAnnounce && (
            <Pressable testID="coach-announce-button" onPress={() => setAnnOpen(true)} style={styles.iconBtn} hitSlop={8}>
              <Ionicons name="megaphone" size={20} color={C.brand} />
            </Pressable>
          )}
          <Pressable testID="notifications-bell" onPress={() => router.push("/notifications")} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="notifications" size={20} color={C.onSurface} />
            {unread > 0 && <View style={styles.dot} />}
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.brand} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <SectionTitle>MY CLASSES TODAY</SectionTitle>
        {mine.length === 0 ? <EmptyState text="No classes assigned to you today." /> : mine.map((c) => <ClassRow key={c.id} c={c} />)}

        <SectionTitle>PRIVATE SESSION REQUESTS</SectionTitle>
        {privates.length === 0 ? (
          <EmptyState icon="person-outline" text="No private session requests." />
        ) : (
          privates.map((p) => (
            <Card key={p.id} style={{ marginBottom: SP.sm }} testID={`private-session-${p.id}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{p.member_name}</Text>
                  <Text style={styles.meta}>
                    {p.date} at {p.time}
                    {p.notes ? ` — ${p.notes}` : ""}
                  </Text>
                </View>
                <Badge text={p.status} tone={p.status === "confirmed" ? "success" : "warning"} />
              </View>
              {p.status === "requested" && (
                <View style={{ flexDirection: "row", gap: SP.sm, marginTop: SP.md }}>
                  <Btn small title="CONFIRM" testID={`confirm-ps-${p.id}`} onPress={() => updatePs(p.id, "confirmed")} style={{ flex: 1 }} />
                  <Btn small title="DECLINE" variant="outline" testID={`decline-ps-${p.id}`} onPress={() => updatePs(p.id, "declined")} style={{ flex: 1 }} />
                </View>
              )}
            </Card>
          ))
        )}

        <SectionTitle>FULL TIMETABLE TODAY</SectionTitle>
        {others.map((c) => (
          <ClassRow key={c.id} c={c} />
        ))}
      </ScrollView>

      <Sheet visible={annOpen} onClose={() => setAnnOpen(false)} title="SEND ANNOUNCEMENT">
        <Input testID="ann-title-input" label="Title" value={annTitle} onChangeText={setAnnTitle} placeholder="e.g. No class Friday" />
        <Input
          testID="ann-body-input"
          label="Message"
          value={annBody}
          onChangeText={setAnnBody}
          placeholder="Write your message…"
          multiline
          style={{ height: 100, textAlignVertical: "top" }}
        />
        <Btn testID="ann-send-button" title="SEND TO ALL MEMBERS" onPress={sendAnn} loading={sending} />
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
  hello: { fontFamily: F.body, fontSize: 11, color: C.brand, letterSpacing: 2 },
  name: { fontFamily: F.display, fontSize: 26, color: C.onSurface, letterSpacing: 1 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: C.error },
  row: { flexDirection: "row", alignItems: "center", gap: SP.md, marginBottom: SP.sm },
  time: { fontFamily: F.display, fontSize: 16, color: C.brand },
  title: { fontFamily: F.bodyBold, fontSize: 15, color: C.onSurface },
  meta: { fontFamily: F.body, fontSize: 12, color: C.onSurface3, marginTop: 2 },
});
