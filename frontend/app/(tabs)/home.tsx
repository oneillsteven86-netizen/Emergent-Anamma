import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ImageBackground, RefreshControl } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import { Card, SectionTitle, Badge, EmptyState } from "@/src/components/UI";
import { C, SP, R, F, IMAGES, DAYS } from "@/src/theme";

export default function Home() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [bookings, setBookings] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [sub, setSub] = useState<any>(null);
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, a, s, n] = await Promise.all([
        api("/bookings/me"),
        api("/announcements"),
        api("/subscriptions/me"),
        api("/notifications"),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      setBookings(b.filter((x: any) => ["booked", "waitlist"].includes(x.status) && x.date >= today).sort((p: any, q: any) => p.date.localeCompare(q.date)));
      setAnnouncements(a);
      setSub(s.find((x: any) => ["active", "frozen", "pending_payment"].includes(x.status)) || null);
      setUnread(n.unread);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const next = bookings[0];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <View>
          <Text style={styles.hello}>WELCOME BACK</Text>
          <Text style={styles.name}>{user?.name?.toUpperCase()}</Text>
        </View>
        <Pressable testID="notifications-bell" onPress={() => router.push("/notifications")} hitSlop={10} style={styles.bell}>
          <Ionicons name="notifications" size={22} color={C.onSurface} />
          {unread > 0 && (
            <View style={styles.dot}>
              <Text style={styles.dotText}>{unread > 9 ? "9+" : unread}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xxl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={C.brand} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />
        }
      >
        {user?.status === "pending" && (
          <Card style={{ borderColor: C.warning, marginBottom: SP.lg }} testID="pending-banner">
            <Text style={{ color: C.warning, fontFamily: F.bodyBold, fontSize: 14 }}>Awaiting approval</Text>
            <Text style={{ color: C.onSurface3, fontFamily: F.body, fontSize: 13, marginTop: 4 }}>
              Your access request is being reviewed by the club. You&apos;ll be notified once approved.
            </Text>
          </Card>
        )}

        <ImageBackground source={{ uri: IMAGES.training }} style={styles.hero} imageStyle={{ borderRadius: R.lg }}>
          <LinearGradient colors={["rgba(10,10,10,0.25)", "rgba(10,10,10,0.92)"]} style={[StyleSheet.absoluteFill, { borderRadius: R.lg }]} />
          <View style={styles.heroContent}>
            <Text style={styles.heroLabel}>{next ? "NEXT SESSION" : "NO UPCOMING SESSIONS"}</Text>
            {next ? (
              <>
                <Text style={styles.heroTitle}>{next.class_name}</Text>
                <Text style={styles.heroMeta}>
                  {next.date} • {next.start_time} • {next.room}
                </Text>
                {next.status === "waitlist" && <Badge text="Waitlist" tone="warning" />}
              </>
            ) : (
              <Pressable testID="hero-book-cta" onPress={() => router.push("/(tabs)/timetable")}>
                <Text style={styles.heroCta}>BOOK YOUR NEXT CLASS →</Text>
              </Pressable>
            )}
          </View>
        </ImageBackground>

        <SectionTitle>MEMBERSHIP</SectionTitle>
        <Card testID="membership-card">
          {sub ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subName}>{sub.plan_name}</Text>
                <Text style={styles.subMeta}>
                  {sub.status === "frozen" ? "Frozen" : sub.status === "pending_payment" ? "Awaiting payment" : `Valid until ${sub.end_date}`}
                  {sub.sessions_remaining != null ? ` • ${sub.sessions_remaining} sessions left` : ""}
                </Text>
              </View>
              <Badge
                text={sub.status.replace("_", " ")}
                tone={sub.status === "active" ? "success" : sub.status === "frozen" ? "warning" : "neutral"}
              />
            </View>
          ) : (
            <Text style={styles.subMeta}>No active membership. Ask at the front desk to get set up.</Text>
          )}
        </Card>

        <SectionTitle>ANNOUNCEMENTS</SectionTitle>
        {announcements.length === 0 ? (
          <EmptyState icon="megaphone-outline" text="No announcements yet." />
        ) : (
          announcements.slice(0, 5).map((a) => (
            <Card key={a.id} style={{ marginBottom: SP.sm }} testID={`announcement-${a.id}`}>
              <Text style={styles.annTitle}>{a.title}</Text>
              <Text style={styles.annBody}>{a.body}</Text>
              <Text style={styles.annMeta}>
                {a.author} • {new Date(a.created_at).toLocaleDateString()}
              </Text>
            </Card>
          ))
        )}

        <SectionTitle>UPCOMING BOOKINGS</SectionTitle>
        {bookings.length === 0 ? (
          <EmptyState text="No upcoming classes. Book your next session." />
        ) : (
          bookings.slice(0, 5).map((b) => (
            <Card key={b.id} style={styles.bookingRow}>
              <View style={styles.dateBox}>
                <Text style={styles.dateDay}>{DAYS[new Date(b.date + "T00:00:00").getDay() === 0 ? 6 : new Date(b.date + "T00:00:00").getDay() - 1]}</Text>
                <Text style={styles.dateNum}>{b.date.slice(8)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.subName}>{b.class_name}</Text>
                <Text style={styles.subMeta}>
                  {b.start_time} • {b.room}
                </Text>
              </View>
              {b.status === "waitlist" && <Badge text="Waitlist" tone="warning" />}
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
    paddingHorizontal: SP.lg, paddingBottom: SP.md, backgroundColor: C.surface, borderBottomWidth: 1, borderColor: C.border,
  },
  hello: { fontFamily: F.body, fontSize: 11, color: C.onSurface3, letterSpacing: 2 },
  name: { fontFamily: F.display, fontSize: 26, color: C.onSurface, letterSpacing: 1 },
  bell: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dot: {
    position: "absolute", top: 4, right: 2, backgroundColor: C.error, borderRadius: 9,
    minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  dotText: { color: "#fff", fontSize: 10, fontFamily: F.bodyBold },
  hero: { height: 180, justifyContent: "flex-end" },
  heroContent: { padding: SP.lg, gap: 4 },
  heroLabel: { fontFamily: F.body, fontSize: 11, color: C.brand, letterSpacing: 2 },
  heroTitle: { fontFamily: F.display, fontSize: 30, color: C.onSurface, letterSpacing: 0.5 },
  heroMeta: { fontFamily: F.body, fontSize: 13, color: C.onSurface2 },
  heroCta: { fontFamily: F.bodyBold, fontSize: 16, color: C.brand, letterSpacing: 0.5 },
  subName: { fontFamily: F.bodyBold, fontSize: 15, color: C.onSurface },
  subMeta: { fontFamily: F.body, fontSize: 13, color: C.onSurface3, marginTop: 2 },
  annTitle: { fontFamily: F.bodyBold, fontSize: 14, color: C.onSurface },
  annBody: { fontFamily: F.body, fontSize: 13, color: C.onSurface2, marginTop: 4, lineHeight: 19 },
  annMeta: { fontFamily: F.body, fontSize: 11, color: C.onSurface3, marginTop: 8 },
  bookingRow: { flexDirection: "row", alignItems: "center", gap: SP.md, marginBottom: SP.sm },
  dateBox: {
    width: 48, height: 48, borderRadius: R.md, backgroundColor: C.brandTint,
    alignItems: "center", justifyContent: "center",
  },
  dateDay: { fontFamily: F.body, fontSize: 10, color: C.onBrandTint, letterSpacing: 1 },
  dateNum: { fontFamily: F.display, fontSize: 18, color: C.onBrandTint },
});
