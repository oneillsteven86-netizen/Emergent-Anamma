import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import { Btn, Input, Chip, EmptyState, Badge, Sheet, useToast, SectionTitle, Card } from "@/src/components/UI";
import { C, SP, R, F } from "@/src/theme";

const TABS = ["Upcoming", "History", "Private"];

export default function Bookings() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [tab, setTab] = useState("Upcoming");
  const [bookings, setBookings] = useState<any[]>([]);
  const [privates, setPrivates] = useState<any[]>([]);
  const [coaches, setCoaches] = useState<any[]>([]);
  const [policy, setPolicy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [psOpen, setPsOpen] = useState(false);
  const [psCoach, setPsCoach] = useState<string | null>(null);
  const [psDate, setPsDate] = useState("");
  const [psTime, setPsTime] = useState("");
  const [psNotes, setPsNotes] = useState("");

  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    try {
      const [b, p, c, s] = await Promise.all([
        user?.role === "member" ? api("/bookings/me") : Promise.resolve([]),
        api("/private-sessions/me"),
        api("/coaches"),
        api("/settings"),
      ]);
      setBookings(b);
      setPrivates(p);
      setCoaches(c.filter((x: any) => x.role === "coach"));
      setPolicy(s.private_session_policy || "");
    } catch {}
  }, [user?.role]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const cancelBooking = async (b: any) => {
    try {
      await api(`/bookings/${b.id}`, { method: "DELETE" });
      toast.show("Booking cancelled");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const requestPs = async () => {
    if (!psCoach || !psDate || !psTime) return toast.show("Coach, date and time required", "error");
    try {
      await api("/private-sessions", { method: "POST", body: { coach_id: psCoach, date: psDate, time: psTime, notes: psNotes } });
      toast.show("Private session requested");
      setPsOpen(false);
      setPsDate(""); setPsTime(""); setPsNotes("");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const upcoming = bookings.filter((b) => ["booked", "waitlist"].includes(b.status) && b.date >= today);
  const history = bookings.filter((b) => !(["booked", "waitlist"].includes(b.status) && b.date >= today));

  const BookingRow = ({ b, cancellable }: any) => (
    <Card style={styles.row} testID={`booking-${b.id}`}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{b.class_name}</Text>
        <Text style={styles.rowMeta}>
          {b.date} • {b.start_time} • {b.room}
        </Text>
      </View>
      <Badge
        text={b.status.replace("_", " ")}
        tone={b.status === "booked" ? "success" : b.status === "attended" ? "gold" : b.status === "waitlist" ? "warning" : b.status === "class_cancelled" ? "error" : "neutral"}
      />
      {cancellable && <Btn small variant="outline" title="CANCEL" testID={`cancel-booking-${b.id}`} onPress={() => cancelBooking(b)} />}
    </Card>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <Text style={styles.title}>BOOKINGS</Text>
      </View>
      <View style={{ height: 56, justifyContent: "center", borderBottomWidth: 1, borderColor: C.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.lg }}>
          {TABS.map((t) => (
            <Chip key={t} label={t} active={tab === t} onPress={() => setTab(t)} testID={`bookings-tab-${t.toLowerCase()}`} />
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.brand} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {tab === "Upcoming" &&
          (upcoming.length === 0 ? (
            <EmptyState text="No upcoming bookings. Hit the timetable to book a class." />
          ) : (
            upcoming.map((b) => <BookingRow key={b.id} b={b} cancellable />)
          ))}

        {tab === "History" &&
          (history.length === 0 ? <EmptyState text="No booking history yet." /> : history.map((b) => <BookingRow key={b.id} b={b} />))}

        {tab === "Private" && (
          <View>
            {user?.role === "member" && (
              <Btn testID="request-private-button" title="REQUEST A PRIVATE SESSION" onPress={() => setPsOpen(true)} style={{ marginBottom: SP.lg }} />
            )}
            {privates.length === 0 ? (
              <EmptyState icon="person-outline" text="No private sessions yet." />
            ) : (
              privates.map((p) => (
                <Card key={p.id} style={styles.row} testID={`private-${p.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {user?.role === "member" ? `Coach ${p.coach_name}` : p.member_name}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {p.date} at {p.time}
                      {p.notes ? ` — ${p.notes}` : ""}
                    </Text>
                  </View>
                  <Badge text={p.status} tone={p.status === "confirmed" ? "success" : p.status === "requested" ? "warning" : "neutral"} />
                  {["requested", "confirmed"].includes(p.status) && (
                    <Btn
                      small
                      variant="outline"
                      title="CANCEL"
                      testID={`cancel-private-${p.id}`}
                      onPress={async () => {
                        await api(`/private-sessions/${p.id}`, { method: "PUT", body: { status: "cancelled" } });
                        toast.show("Session cancelled");
                        load();
                      }}
                    />
                  )}
                </Card>
              ))
            )}
            {policy ? (
              <View style={{ marginTop: SP.lg }}>
                <SectionTitle>CANCELLATION POLICY</SectionTitle>
                <Text style={styles.policy}>{policy}</Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Sheet visible={psOpen} onClose={() => setPsOpen(false)} title="PRIVATE SESSION">
        <Text style={styles.label}>CHOOSE COACH</Text>
        {coaches.map((co) => (
          <Pressable key={co.id} testID={`ps-coach-${co.id}`} style={[styles.coachRow, psCoach === co.id && { borderColor: C.brand }]} onPress={() => setPsCoach(co.id)}>
            {co.photo ? <Image source={{ uri: co.photo }} style={styles.coachPic} /> : <View style={[styles.coachPic, { backgroundColor: C.brandTint }]} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{co.name}</Text>
              <Text style={styles.rowMeta} numberOfLines={2}>{co.bio}</Text>
            </View>
          </Pressable>
        ))}
        <View style={{ flexDirection: "row", gap: SP.sm, marginTop: SP.md }}>
          <View style={{ flex: 1 }}>
            <Input testID="ps-date-input" label="Date (YYYY-MM-DD)" value={psDate} onChangeText={setPsDate} placeholder={today} />
          </View>
          <View style={{ flex: 1 }}>
            <Input testID="ps-time-input" label="Time (HH:MM)" value={psTime} onChangeText={setPsTime} placeholder="17:00" />
          </View>
        </View>
        <Input testID="ps-notes-input" label="Notes (optional)" value={psNotes} onChangeText={setPsNotes} placeholder="What do you want to work on?" />
        <Btn testID="ps-submit-button" title="SEND REQUEST" onPress={requestPs} />
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
  rowMeta: { fontFamily: F.body, fontSize: 12, color: C.onSurface3, marginTop: 2 },
  policy: { fontFamily: F.body, fontSize: 13, color: C.onSurface3, lineHeight: 19 },
  label: { color: C.onSurface3, fontFamily: F.bodyBold, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 },
  coachRow: {
    flexDirection: "row", alignItems: "center", gap: SP.md, backgroundColor: C.surface3,
    borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: SP.md, marginBottom: SP.sm,
  },
  coachPic: { width: 44, height: 44, borderRadius: 22 },
});
